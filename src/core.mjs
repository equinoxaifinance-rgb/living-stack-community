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
  return { file, session };
}

function verifyLedger(session) {
  let previous = '0'.repeat(64);
  for (const event of session.events) {
    const given = event.hash;
    const material = { ...event };
    delete material.hash;
    if (event.previous_hash !== previous || sha256(stable(material)) !== given) throw new Error('ledger_integrity_failure');
    previous = given;
  }
  return previous;
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
      created_at: new Date().toISOString(), scope_hash: sha256(scope), goal_hash: sha256(goal),
      budget: { limit_usd: budget, reserved_usd: 0, spent_usd: 0 },
      retention_hours: retention, authorizations: {}, outcomes: {}, events: [],
    };
    append(session, 'session_started', { scope_hash: session.scope_hash, goal_hash: session.goal_hash, budget_limit_usd: budget, retention_hours: retention });
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
      target_hash: sha256(cleanText(args.target || '', 2000)), used: false,
    };
    session.authorizations[authorization_id] = authorization;
    session.budget.reserved_usd = money(session.budget.reserved_usd + estimate);
    append(session, 'action_authorized', authorization);
    writeSession(file, session);
    return { decision: 'PASS', authorization_id, target_hash: authorization.target_hash, reserved_usd: estimate };
  }

  recordOutcome(args = {}) {
    const { file, session } = readSession(args.session_id);
    open(session);
    const authorization = session.authorizations[args.authorization_id];
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
  }

  checkClaim(args = {}) {
    const { file, session } = readSession(args.session_id);
    open(session);
    const missing = [];
    if (!String(args.subject || '').trim()) missing.push('subject');
    if (!Array.isArray(args.outcome_ids) || !args.outcome_ids.length) missing.push('outcome_ids');
    if (missing.length) return { decision: 'UNRESOLVED', reason: 'claim_binding_required', binding_missing: missing };
    const claim = requireText(args.claim_text, 'claim_text', 8000);
    const subject_hash = sha256(cleanText(args.subject, 2000));
    const maxAge = Math.max(1, Math.min(31536000, Number(args.max_age_seconds || 7200)));
    const required = new Set(Array.isArray(args.required_evidence_types) ? args.required_evidence_types.map(v => cleanText(v, 64)) : []);
    const accepted = [];
    const rejected = [];
    for (const outcomeId of args.outcome_ids.slice(0, 20)) {
      const outcome = session.outcomes[outcomeId];
      if (!outcome) { rejected.push({ outcome_id: outcomeId, reason: 'unknown_outcome' }); continue; }
      const age = (Date.now() - Date.parse(outcome.recorded_at)) / 1000;
      const types = new Set(outcome.evidence.map(row => row.type));
      const reason = outcome.classification !== 'success' ? 'outcome_not_success'
        : outcome.target_hash !== subject_hash ? 'subject_mismatch'
        : age > maxAge ? 'evidence_stale'
        : [...required].some(type => !types.has(type)) ? 'required_evidence_missing' : null;
      if (reason) rejected.push({ outcome_id: outcomeId, reason }); else accepted.push(outcomeId);
    }
    const decision = accepted.length ? 'PASS' : 'UNRESOLVED';
    append(session, 'claim_checked', { claim_hash: sha256(claim), subject_hash, decision, accepted_outcome_ids: accepted, rejected_outcomes: rejected });
    writeSession(file, session);
    return { decision, reason: decision === 'PASS' ? 'evidence_bound' : 'no_qualifying_evidence', accepted_outcome_ids: accepted, rejected_outcomes: rejected, subject_hash };
  }

  sessionClose(args = {}) {
    const { file, session } = readSession(args.session_id);
    open(session);
    session.status = 'closed';
    append(session, 'session_closed', { reason_hash: sha256(requireText(args.reason || 'completed', 'reason', 500)) });
    writeSession(file, session);
    return { decision: 'PASS', session_id: session.session_id, status: 'closed', ledger_head: session.events.at(-1).hash };
  }
}
