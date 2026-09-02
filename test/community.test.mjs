import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CommunityCore } from '../src/core.mjs';
import { COMMUNITY_TOOLS } from '../src/util.mjs';
import { TOOL_DEFINITIONS, callTool } from '../src/tools.mjs';

function isolate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-stack-community-'));
  process.env.LIVING_STACK_STATE_DIR = root;
  return root;
}

test('Community exposes exactly the seven-tool proof loop', () => {
  assert.equal(TOOL_DEFINITIONS.length, 7);
  assert.deepEqual(TOOL_DEFINITIONS.map(row => row.name), [...COMMUNITY_TOOLS]);
  for (const paid of ['livingstack.context_put', 'livingstack.checkpoint_save', 'livingstack.trace_export', 'livingstack.verify_release', 'livingstack.team_delegate']) {
    assert.equal(callTool(new CommunityCore(), paid, {}).reason, 'paid_capability');
  }
});

test('Community completes a subject-bound evidence loop', () => {
  const root = isolate();
  const core = new CommunityCore();
  const started = core.sessionStart({ scope: 'test', goal: 'prove one bounded action', budget_limit_usd: 1 });
  const authorization = core.authorizeAction({ session_id: started.session_id, action_id: 'test-read-001', action_type: 'file.read', risk: 'read', estimated_cost_usd: 0.25, target: 'artifact-A' });
  const outcome = core.recordOutcome({ session_id: started.session_id, authorization_id: authorization.authorization_id, classification: 'success', actual_cost_usd: 0.2, evidence: [{ type: 'verification', ref: 'receipt-A' }] });
  const claim = core.checkClaim({ session_id: started.session_id, claim_text: 'artifact A was verified', subject: 'artifact-A', outcome_ids: [outcome.outcome_id], required_evidence_types: ['verification'] });
  assert.equal(claim.decision, 'PASS');
  assert.equal(core.sessionClose({ session_id: started.session_id, reason: 'done' }).status, 'closed');
  assert.equal(core.sessionStatus({ session_id: started.session_id }).ledger_valid, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Community fails closed on external actions, overspend, mismatch, reuse, and tampering', () => {
  const root = isolate();
  const core = new CommunityCore();
  const started = core.sessionStart({ scope: 'hostile', goal: 'reject unsafe paths', budget_limit_usd: 0.1 });
  assert.equal(core.authorizeAction({ session_id: started.session_id, action_id: 'external-001', action_type: 'network.post', risk: 'external', target: 'remote' }).decision, 'DENY');
  assert.equal(core.authorizeAction({ session_id: started.session_id, action_id: 'budget-001', action_type: 'model.call', risk: 'read', estimated_cost_usd: 1, target: 'model' }).reason, 'budget_exceeded');
  const auth = core.authorizeAction({ session_id: started.session_id, action_id: 'safe-001', action_type: 'file.read', risk: 'read', estimated_cost_usd: 0.1, target: 'A' });
  const out = core.recordOutcome({ session_id: started.session_id, authorization_id: auth.authorization_id, classification: 'success', actual_cost_usd: 0.1, evidence: [{ type: 'verification', ref: 'receipt' }] });
  assert.throws(() => core.recordOutcome({ session_id: started.session_id, authorization_id: auth.authorization_id, classification: 'success' }), /already_used/);
  assert.equal(core.checkClaim({ session_id: started.session_id, claim_text: 'B is done', subject: 'B', outcome_ids: [out.outcome_id] }).decision, 'UNRESOLVED');
  const file = path.join(root, 'sessions', `${started.session_id}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.events[0].payload.scope_hash = 'tampered';
  fs.writeFileSync(file, JSON.stringify(data));
  assert.throws(() => core.sessionStatus({ session_id: started.session_id }), /ledger_integrity_failure/);
  fs.rmSync(root, { recursive: true, force: true });
});
