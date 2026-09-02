import { COMMUNITY_TOOLS, PAID_ONLY_CAPABILITIES, VERSION, jsonResult } from './util.mjs';

const object = (properties = {}, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const s = (description, extra = {}) => ({ type: 'string', description, ...extra });
const n = (description, extra = {}) => ({ type: 'number', description, ...extra });

const definitions = [
  ['livingstack.status', 'Inspect Community capabilities and the paid boundary.', object()],
  ['livingstack.session_start', 'Start an isolated proof session with an immutable scope and budget.', object({ scope: s('Bounded scope.'), goal: s('Concrete goal.'), budget_limit_usd: n('Hard cost ceiling.', { minimum: 0, default: 0 }), retention_hours: n('Retention hours.', { minimum: 1, maximum: 8760, default: 24 }) }, ['scope', 'goal'])],
  ['livingstack.session_status', 'Verify a session lifecycle, budget, counts, and ledger head.', object({ session_id: s('Session identifier.') }, ['session_id'])],
  ['livingstack.authorize_action', 'Gate one local host action against scope risk and budget; never executes it.', object({ session_id: s('Session identifier.'), action_id: s('Stable caller action ID.'), action_type: s('Action category.'), risk: s('Risk class.', { enum: ['read', 'local_write', 'external', 'destructive'], default: 'read' }), estimated_cost_usd: n('Maximum reserved cost.', { minimum: 0, default: 0 }), target: s('Target description; only its digest is retained.', { default: '' }) }, ['session_id', 'action_id', 'action_type'])],
  ['livingstack.record_outcome', 'Consume one authorization and bind its observed result to typed evidence.', object({ session_id: s('Session identifier.'), authorization_id: s('Authorization identifier.'), classification: s('Observed class.', { enum: ['success', 'failure', 'mixed', 'unresolved'] }), actual_cost_usd: n('Observed cost.', { minimum: 0, default: 0 }), evidence: { type: 'array', maxItems: 50, default: [], items: object({ type: s('Evidence type.'), ref: s('Receipt or reference; only its digest is retained.') }, ['type', 'ref']) }, summary: s('Short summary; only its digest is retained.', { default: '' }) }, ['session_id', 'authorization_id', 'classification'])],
  ['livingstack.check_claim', 'Check a proposed claim against explicitly selected, fresh, successful, subject-bound evidence.', object({ session_id: s('Session identifier.'), claim_text: s('Exact proposed claim.'), subject: s('Exact claim subject.'), outcome_ids: { type: 'array', minItems: 1, maxItems: 20, items: s('Outcome identifier.') }, required_evidence_types: { type: 'array', maxItems: 20, default: [], items: s('Required evidence type.') }, max_age_seconds: n('Evidence freshness ceiling.', { minimum: 1, maximum: 31536000, default: 7200 }) }, ['session_id', 'claim_text', 'subject', 'outcome_ids'])],
  ['livingstack.session_close', 'Close a proof session and preserve its tamper-evident local ledger.', object({ session_id: s('Session identifier.'), reason: s('Closure reason.', { default: 'completed' }) }, ['session_id'])],
].map(([name, description, inputSchema]) => ({ name, title: name.replace('livingstack.', 'Living Stack: '), description, inputSchema, outputSchema: { type: 'object', additionalProperties: true }, annotations: { readOnlyHint: ['livingstack.status', 'livingstack.session_status'].includes(name), destructiveHint: false, idempotentHint: ['livingstack.status', 'livingstack.session_status'].includes(name), openWorldHint: false } }));

export const TOOL_DEFINITIONS = Object.freeze(definitions);

const dispatch = {
  'livingstack.status': 'status', 'livingstack.session_start': 'sessionStart',
  'livingstack.session_status': 'sessionStatus', 'livingstack.authorize_action': 'authorizeAction',
  'livingstack.record_outcome': 'recordOutcome', 'livingstack.check_claim': 'checkClaim',
  'livingstack.session_close': 'sessionClose',
};

export function callTool(core, name, args) {
  if (!COMMUNITY_TOOLS.includes(name)) return { decision: 'FAIL', reason: 'paid_capability', upgrade_url: 'https://living-stack-mcp.pages.dev/#pricing' };
  return core[dispatch[name]](args || {});
}

export { jsonResult };

export function capabilities() {
  return { schema: 'living-stack-community-capabilities.v1', edition: 'community-proof-loop', version: VERSION, tools: COMMUNITY_TOOLS, paid_only_capabilities: PAID_ONLY_CAPABILITIES, upgrade_url: 'https://living-stack-mcp.pages.dev/#pricing' };
}
