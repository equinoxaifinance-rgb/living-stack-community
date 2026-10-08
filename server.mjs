#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CommunityCore } from './src/core.mjs';
import { TOOL_DEFINITIONS, callTool, capabilities, jsonResult } from './src/tools.mjs';
import { VERSION } from './src/util.mjs';

const INSTRUCTIONS = [
  'Living Stack Community gates and records host actions; it never executes them.',
  'Use the tools in this order: livingstack.session_start (scope, goal, budget) -> livingstack.authorize_action before each host action -> perform the action yourself -> livingstack.record_outcome with typed evidence -> livingstack.check_claim before saying the work is done -> livingstack.session_close.',
  'Only report a claim as verified when check_claim returns PASS. External and destructive actions are rejected by the default policy.'
].join(' ');

export function createServer(core = new CommunityCore()) {
  const server = new Server({ name: 'living-stack-community', version: VERSION }, { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const result = callTool(core, request.params.name, request.params.arguments || {});
      return jsonResult(result, result?.reason === 'unknown_tool');
    }
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

// npx and npm-installed bins launch through a symlink, so compare real paths.
const realpath = file => { try { return fs.realpathSync(file); } catch { return path.resolve(file); } };
const entry = process.argv[1] && realpath(process.argv[1]).toLowerCase() === realpath(fileURLToPath(import.meta.url)).toLowerCase();
if (entry) {
  if (process.argv.includes('--self-test')) {
    try { const result = await selfTest(); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.decision !== 'PASS') process.exitCode = 1; }
    catch (error) { process.stderr.write(`${String(error?.stack || error)}\n`); process.exitCode = 1; }
  } else {
    const server = createServer();
    await server.connect(new StdioServerTransport());
  }
}
