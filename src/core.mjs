import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMUNITY_TOOLS, PAID_ONLY_CAPABILITIES, VERSION, cleanText, id, money, requireText, sha256, stable } from './util.mjs';

function stateRoot() {
  return path.resolve(process.env.LIVING_STACK_STATE_DIR || path.join(os.homedir(), '.living-stack-community'));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function sessionPath(sessionId) {
  if (!/^ses_[0-9a-f-]{36}$/.test(String(sessionId || ''))) throw new Error('invalid session_id');
  return path.join(stateRoot(), 'sessions', `${sessionId}.json`);
}

function readSession(sessionId) {
  const file = sessionPath(sessionId);
  const session = JSON.parse(fs.readFileSync(file, 'utf8'));
  verifyLedger(session);
  if (session.session_id !== sessionId) throw new Error('session_identity_integrity_failure');
  return { file, session };
}

function verifyLedger(session) {
  if (!Array.isArray(session.events) || !session.events.length) throw new Error('ledger_integrity_failure');
  let previous = '0'.repeat(64);
  let sequence = 0;
  for (const event of session.events) {
    const given = event.hash;
    const material = { ...event };
    delete material.hash;
    if (event.sequence !== ++sequence || !Number.isFinite(Date.parse(event.timestamp)) || event.previous_hash !== previous || sha256(stable(material)) !== given) throw new Error('ledger_integrity_failure');
    previous = given;
  }
  // The event chain is authoritative. A valid chain alone does not authenticate
  // the separate mutable maps used by authorization and claim checking.
  const first = session.events[0];
  if (first.type !== 'session_started') throw new Error('ledger_integrity_failure');
  const initial = first.payload;
  const budget = { limit_usd: initial.budget_limit_usd, reserved_usd: 0, spent_usd: 0 };
  const authorizations = Object.create(null);
  const outcomes = Object.create(null);
  let status = 'open';
  for (const event of session.events.slice(1)) {
    const value = event.payload;
    if (status !== 'open') throw new Error('ledger_integrity_failure');
    if (event.type === 'action_authorized') {
      if (Object.hasOwn(authorizations, value.authorization_id)) throw new Error('ledger_integrity_failure');
      authorizations[value.authorization_id] = { ...value };
      budget.reserved_usd = money(budget.reserved_usd + value.estimated_cost_usd);
    } else if (event.type === 'outcome_recorded') {
      const auth = authorizations[value.authorization_id];
      if (!auth || auth.used || Object.hasOwn(outcomes, value.outcome_id)) throw new Error('ledger_integrity_failure');
      auth.used = true;
      budget.reserved_usd = money(budget.reserved_usd - auth.estimated_cost_usd);
      budget.spent_usd = money(budget.spent_usd + value.actual_cost_usd);
      outcomes[value.outcome_id] = value;
    } else if (event.type === 'session_closed') {
      status = 'closed';
    } else if (!['authorization_denied', 'claim_checked'].includes(event.type)) {
      throw new Error('ledger_integrity_failure');
    }
  }
  if (session.status !== status || session.scope_hash !== initial.scope_hash || session.goal_hash !== initial.goal_hash ||
      session.retention_hours !== initial.retention_hours ||
      stable(session.budget) !== stable(budget) || stable(session.authorizations) !== stable(authorizations) ||
      stable(session.outcomes) !== stable(outcomes) ||
      (session.binding_version ?? 1) !== (initial.binding_version ?? 1) ||
      (initial.binding_version === 2 && (initial.session_id !== session.session_id || initial.created_at !== session.created_at))) {
    throw new Error('materialized_state_integrity_failure');
  }
  return previous;
}

function identityText(value, name, max = 2000) {
  // Hash the original bounded identity; redact only display text, never the
  // material being bound. Raw identity strings are not persisted.
  if (typeof value !== 'string' || value.length > max) throw new Error(`invalid ${name}`);
  return value;
}

function append(session, type, payload = {}) {
  const previous_hash = session.events.at(-1)?.hash || '0'.repeat(64);
  const event = { sequence: session.events.length + 1, timestamp: new Date().toISOString(), type, payload, previous_hash };
  event.hash = sha256(stable(event));
  session.events.push(event);
  return event;
}

function writeSession(file, session) {
  ensureDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function open(session) {
  if (session.status !== 'open') throw new Error('session_closed');
  if (session.binding_version !== 2) throw new Error('legacy_session_read_only_start_new_session');
}

function withSessionLock(sessionId, operation) {
  const lock = `${sessionPath(sessionId)}.lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('session_busy_retry');
    throw error;
  }
  // Lock covers the whole read/verify/mutate/write transaction. Never steal a
  // lock on a timer: a delayed writer may still own it. Crash leftovers fail
  // closed until the operator has stopped writers and removes the exact lock.
  try {
    return operation();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

export class CommunityCore {
  status() {
    return {
      decision: 'PASS',
      product: 'Living Stack Community',
      edition: 'community-proof-loop',
      version: VERSION,
      mode: 'standalone-local',
      tool_count: COMMUNITY_TOOLS.length,
      tools: COMMUNITY_TOOLS,
      paid_only_capabilities: PAID_ONLY_CAPABILITIES,
      upgrade_url: 'https://living-stack-mcp.pages.dev/#pricing',
      boundary: 'Community proves one scoped evidence loop. Complete Local adds durable intelligence, portable proof, release integrity, and team coordination.',
    };
  }

  sessionStart(args = {}) {
    const scope = requireText(args.scope, 'scope', 500);
    const goal = requireText(args.goal, 'goal', 4000);
    const budget = money(args.budget_limit_usd, 'budget_limit_usd');
    const retention = Math.max(1, Math.min(8760, Number(args.retention_hours || 24)));
    const session_id = id('ses');
    const file = sessionPath(session_id);
    const session = {
      schema: 'living-stack-community-session.v1', session_id, status: 'open',
      binding_version: 2,
      created_at: new Date().toISOString(), scope_hash: sha256(scope), goal_hash: sha256(goal),
      budget: { limit_usd: budget, reserved_usd: 0, spent_usd: 0 },
      retention_hours: retention, authorizations: {}, outcomes: {}, events: [],
    };
    append(session, 'session_started', { scope_hash: session.scope_hash, goal_hash: session.goal_hash, budget_limit_usd: budget, retention_hours: retention, binding_version: 2, session_id, created_at: session.created_at });
    writeSession(file, session);
    return { decision: 'PASS', session_id, scope_hash: session.scope_hash, ledger_head: session.events.at(-1).hash };
  }

  sessionStatus(args = {}) {
    const { session } = readSession(args.session_id);
    return {
      decision: 'PASS', session_id: session.session_id, status: session.status,
      scope_hash: session.scope_hash, budget: session.budget,
      authorization_count: Object.keys(session.authorizations).length,
      outcome_count: Object.keys(session.outcomes).length,
      event_count: session.events.length, ledger_head: verifyLedger(session), ledger_valid: true,
    };
  }

  authorizeAction(args = {}) {
    return withSessionLock(args.session_id, () => {
    const { file, session } = readSession(args.session_id);
    open(session);
    const action_id = requireText(args.action_id, 'action_id', 96);
    if (!/^[A-Za-z0-9._-]{3,96}$/.test(action_id)) throw new Error('invalid action_id');
    if (Object.values(session.authorizations).some(row => row.action_id === action_id)) throw new Error('duplicate action_id');
    const action_type = requireText(args.action_type, 'action_type', 120);
    const risk = String(args.risk || 'read');
    if (!['read', 'local_write', 'external', 'destructive'].includes(risk)) throw new Error('invalid risk');
    if (risk === 'external' || risk === 'destructive') {
      append(session, 'authorization_denied', { action_id, action_type, risk, reason: 'community_default_policy' });
      writeSession(file, session);
      return { decision: 'DENY', reason: 'community_default_policy', risk };
    }
    const estimate = money(args.estimated_cost_usd, 'estimated_cost_usd');
    if (session.budget.spent_usd + session.budget.reserved_usd + estimate > session.budget.limit_usd) {
      append(session, 'authorization_denied', { action_id, action_type, risk, reason: 'budget_exceeded' });
      writeSession(file, session);
      return { decision: 'DENY', reason: 'budget_exceeded' };
    }
    const authorization_id = id('auth');
    const authorization = {
      authorization_id, action_id, action_type, risk, estimated_cost_usd: estimate,
      target_hash: sha256(identityText(args.target ?? '', 'target')), used: false,
    };
    session.authorizations[authorization_id] = authorization;
    session.budget.reserved_usd = money(session.budget.reserved_usd + estimate);
    append(session, 'action_authorized', authorization);
    writeSession(file, session);
    return { decision: 'PASS', authorization_id, target_hash: authorization.target_hash, reserved_usd: estimate };
    });
  }

  recordOutcome(args = {}) {
    return withSessionLock(args.session_id, () => {
    const { file, session } = readSession(args.session_id);
    open(session);
    const authorization = Object.hasOwn(session.authorizations, args.authorization_id) ? session.authorizations[args.authorization_id] : null;
    if (!authorization) throw new Error('unknown authorization_id');
    if (authorization.used) throw new Error('authorization_already_used');
    const classification = String(args.classification || '');
    if (!['success', 'failure', 'mixed', 'unresolved'].includes(classification)) throw new Error('invalid classification');
    const actual = money(args.actual_cost_usd, 'actual_cost_usd');
    if (actual > authorization.estimated_cost_usd) throw new Error('actual_cost_exceeds_reservation');
    const evidence = Array.isArray(args.evidence) ? args.evidence.slice(0, 50).map(row => ({
      type: requireText(row?.type, 'evidence.type', 64), ref_hash: sha256(requireText(row?.ref, 'evidence.ref', 500)),
    })) : [];
    authorization.used = true;
    session.budget.reserved_usd = money(session.budget.reserved_usd - authorization.estimated_cost_usd);
    session.budget.spent_usd = money(session.budget.spent_usd + actual);
    const outcome_id = id('out');
    const outcome = {
      outcome_id, authorization_id: authorization.authorization_id, classification,
      actual_cost_usd: actual, target_hash: authorization.target_hash, evidence,
      summary_hash: sha256(cleanText(args.summary || '', 4000)), recorded_at: new Date().toISOString(),
    };
    session.outcomes[outcome_id] = outcome;
    append(session, 'outcome_recorded', outcome);
    writeSession(file, session);
    return { decision: 'PASS', outcome_id, classification, target_hash: outcome.target_hash, evidence_types: evidence.map(row => row.type) };
    });
  }

  checkClaim(args = {}) {
    return withSessionLock(args.session_id, () => {
    const { file, session } = readSession(args.session_id);
    open(session);
    const missing = [];
    if (!String(args.subject || '').trim()) missing.push('subject');
    if (!Array.isArray(args.outcome_ids) || !args.outcome_ids.length) missing.push('outcome_ids');
    if (missing.length) return { decision: 'UNRESOLVED', reason: 'claim_binding_required', binding_missing: missing };
    const claim = requireText(args.claim_text, 'claim_text', 8000);
    const subject_hash = sha256(identityText(args.subject, 'subject'));
    const maxAge = args.max_age_seconds ?? 7200;
    if (typeof maxAge !== 'number' || !Number.isFinite(maxAge) || maxAge < 1 || maxAge > 31536000) throw new Error('invalid max_age_seconds');
    if (args.outcome_ids.length > 20 || args.outcome_ids.some(id => typeof id !== 'string')) throw new Error('invalid outcome_ids');
    const required = new Set(['verification', ...(Array.isArray(args.required_evidence_types) ? args.required_evidence_types.map(v => requireText(v, 'required_evidence_type', 64)) : [])]);
    const accepted = [];
    const rejected = [];
    for (const outcomeId of new Set(args.outcome_ids)) {
      const outcome = Object.hasOwn(session.outcomes, outcomeId) ? session.outcomes[outcomeId] : null;
      if (!outcome) { rejected.push({ outcome_id: outcomeId, reason: 'unknown_outcome' }); continue; }
      const age = (Date.now() - Date.parse(outcome.recorded_at)) / 1000;
      const types = new Set(outcome.evidence.map(row => row.type));
      const reason = outcome.classification !== 'success' ? 'outcome_not_success'
        : outcome.target_hash !== subject_hash ? 'subject_mismatch'
        : !Number.isFinite(age) || age < 0 || age > maxAge ? 'evidence_stale'
        : !outcome.evidence.length ? 'missing_evidence_reference'
        : [...required].some(type => !types.has(type)) ? 'required_evidence_missing' : null;
      if (reason) rejected.push({ outcome_id: outcomeId, reason }); else accepted.push(outcomeId);
    }
    const decision = accepted.length && !rejected.length ? 'PASS' : 'UNRESOLVED';
    append(session, 'claim_checked', { claim_hash: sha256(claim), subject_hash, decision, accepted_outcome_ids: accepted, rejected_outcomes: rejected });
    writeSession(file, session);
    return { decision, reason: decision === 'PASS' ? 'evidence_bound' : 'no_qualifying_evidence', accepted_outcome_ids: accepted, rejected_outcomes: rejected, subject_hash };
    });
  }

  sessionClose(args = {}) {
    return withSessionLock(args.session_id, () => {
    const { file, session } = readSession(args.session_id);
    open(session);
    session.status = 'closed';
    append(session, 'session_closed', { reason_hash: sha256(requireText(args.reason || 'completed', 'reason', 500)) });
    writeSession(file, session);
    return { decision: 'PASS', session_id: session.session_id, status: 'closed', ledger_head: session.events.at(-1).hash };
    });
  }
}
