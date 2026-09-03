import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CommunityCore } from '../src/core.mjs';
import { sha256, stable } from '../src/util.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'community-integrity-'));
  process.env.LIVING_STACK_STATE_DIR = root;
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const core = new CommunityCore();
  const { session_id } = core.sessionStart({ scope: 'regression', goal: 'Reject false green claims', budget_limit_usd: 1 });
  let serial = 0;
  function outcome(target, classification = 'success', evidence = [{ type: 'verification', ref: 'test-receipt' }]) {
    const auth = core.authorizeAction({ session_id, action_id: `test-${++serial}`, action_type: 'fixture.read', target });
    return core.recordOutcome({ session_id, authorization_id: auth.authorization_id, classification, evidence });
  }
  function claim(subject, outcome_ids, extra = {}) {
    return core.checkClaim({ session_id, claim_text: 'Selected evidence proves this exact target', subject, outcome_ids, ...extra });
  }
  function edit(callback) {
    const file = path.join(root, 'sessions', `${session_id}.json`);
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    callback(state);
    fs.writeFileSync(file, JSON.stringify(state));
  }
  return { core, session_id, outcome, claim, edit };
}

test('empty evidence and irrelevant evidence never approve a completion claim', t => {
  const f = fixture(t);
  for (const evidence of [[], [{ type: 'note', ref: 'not-a-verification' }]]) {
    const result = f.outcome('A', 'success', evidence);
    assert.equal(f.claim('A', [result.outcome_id]).decision, 'UNRESOLVED');
  }
});

test('every selected outcome must be valid, successful and bound', t => {
  const f = fixture(t);
  const good = f.outcome('A');
  const failed = f.outcome('A', 'failure');
  const wrongTarget = f.outcome('B');
  for (const id of [failed.outcome_id, wrongTarget.outcome_id, 'out_missing']) {
    assert.equal(f.claim('A', [good.outcome_id, id]).decision, 'UNRESOLVED');
  }
  assert.equal(f.claim('A', [good.outcome_id]).decision, 'PASS');
});

test('raw release hashes and credential-shaped subjects cannot collapse under redaction', t => {
  const f = fixture(t);
  for (const [a, b] of [
    [`release sha256:${'a'.repeat(64)}`, `release sha256:${'b'.repeat(64)}`],
    [`fixture sk-${'a'.repeat(20)}`, `fixture sk-${'b'.repeat(20)}`],
  ]) {
    const out = f.outcome(a);
    assert.equal(f.claim(b, [out.outcome_id]).decision, 'UNRESOLVED');
    assert.equal(f.claim(a, [out.outcome_id]).decision, 'PASS');
  }
});

test('binding rejects overlong targets instead of silently truncating identity', t => {
  const f = fixture(t);
  assert.throws(() => f.outcome('x'.repeat(2001)), /target/);
});

test('materialized budget, scope and lifecycle edits fail integrity checks', t => {
  const f = fixture(t);
  f.edit(s => { s.budget.limit_usd = 100000; });
  assert.throws(() => f.core.sessionStatus({ session_id: f.session_id }), /integrity/);
  assert.throws(() => f.core.authorizeAction({ session_id: f.session_id, action_id: 'over-budget', action_type: 'fixture.read', estimated_cost_usd: 50 }), /integrity/);
});

test('changing a failed outcome to successful without updating its ledger is detected', t => {
  const f = fixture(t);
  const out = f.outcome('A', 'failure');
  f.edit(s => { s.outcomes[out.outcome_id].classification = 'success'; });
  assert.throws(() => f.claim('A', [out.outcome_id]), /integrity/);
});

test('reopening a closed materialized state is rejected and ordinary closed reads still work', t => {
  const f = fixture(t);
  f.core.sessionClose({ session_id: f.session_id });
  assert.equal(f.core.sessionStatus({ session_id: f.session_id }).status, 'closed');
  f.edit(s => { s.status = 'open'; });
  assert.throws(() => f.core.sessionStatus({ session_id: f.session_id }), /integrity/);
});

test('invalid freshness values cannot bypass the evidence window', t => {
  const f = fixture(t);
  const out = f.outcome('A');
  for (const max_age_seconds of ['not-a-number', 0, -1, Infinity]) {
    assert.throws(() => f.claim('A', [out.outcome_id], { max_age_seconds }), /max_age_seconds/);
  }
});

test('legacy sessions are preserved for reading but never silently reinterpreted', t => {
  const f = fixture(t);
  f.edit(s => {
    delete s.binding_version;
    for (const key of ['binding_version', 'session_id', 'created_at']) delete s.events[0].payload[key];
    const event = { ...s.events[0] };
    delete event.hash;
    s.events[0].hash = sha256(stable(event));
  });
  assert.equal(f.core.sessionStatus({ session_id: f.session_id }).ledger_valid, true);
  assert.throws(() => f.outcome('legacy'), /legacy_session_read_only/);
});

test('scope, authorization and retention state must match the stored event chain', t => {
  for (const modify of [s => { s.scope_hash = 'other'; }, s => { s.retention_hours = 8760; }, s => { s.authorizations = {}; }]) {
    const f = fixture(t);
    f.outcome('A');
    f.edit(modify);
    assert.throws(() => f.core.sessionStatus({ session_id: f.session_id }), /integrity/);
  }
});
