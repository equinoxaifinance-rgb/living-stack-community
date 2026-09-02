#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CommunityCore } from './src/core.mjs';
import { TOOL_DEFINITIONS, callTool, capabilities, jsonResult } from './src/tools.mjs';
import { VERSION } from './src/util.mjs';

export function createServer(core = new CommunityCore()) {
  const server = new Server({ name: 'living-stack-community', version: VERSION }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try { return jsonResult(callTool(core, request.params.name, request.params.arguments || {})); }
    catch (error) { return jsonResult({ decision: 'FAIL', reason: 'invalid_or_rejected_request', message: String(error?.message || error).slice(0, 300) }, true); }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: 'livingstack://capabilities', name: 'Living Stack Community capabilities', mimeType: 'application/json' }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== 'livingstack://capabilities') throw new Error('unknown resource');
    return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(capabilities(), null, 2) }] };
  });
  return server;
}

async function selfTest() {
  const core = new CommunityCore();
  const started = core.sessionStart({ scope: 'self-test', goal: 'prove the Community evidence loop', budget_limit_usd: 0 });
  const authorization = core.authorizeAction({ session_id: started.session_id, action_id: 'community-self-test', action_type: 'verification.read', risk: 'read', target: 'community-self-test' });
  const outcome = core.recordOutcome({ session_id: started.session_id, authorization_id: authorization.authorization_id, classification: 'success', evidence: [{ type: 'verification', ref: 'self-test-receipt' }] });
  const claim = core.checkClaim({ session_id: started.session_id, claim_text: 'Community proof loop completed', subject: 'community-self-test', outcome_ids: [outcome.outcome_id], required_evidence_types: ['verification'] });
  const closed = core.sessionClose({ session_id: started.session_id, reason: 'self-test complete' });
  return { decision: claim.decision, edition: 'community-proof-loop', version: VERSION, tool_count: TOOL_DEFINITIONS.length, session_id: started.session_id, outcome_id: outcome.outcome_id, ledger_head: closed.ledger_head };
}

const entry = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (entry) {
  if (process.argv.includes('--self-test')) {
    try { const result = await selfTest(); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.decision !== 'PASS') process.exitCode = 1; }
    catch (error) { process.stderr.write(`${String(error?.stack || error)}\n`); process.exitCode = 1; }
  } else {
    const server = createServer();
    await server.connect(new StdioServerTransport());
  }
}
