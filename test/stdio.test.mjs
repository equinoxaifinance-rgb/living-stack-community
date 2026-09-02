import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('a real MCP client discovers only Community and calls it end to end', async t => {
  const project = path.resolve(import.meta.dirname, '..');
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'living-stack-community-stdio-'));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(project, 'server.mjs')], env: { ...process.env, LIVING_STACK_STATE_DIR: state }, stderr: 'pipe' });
  const client = new Client({ name: 'community-verifier', version: '1.0.0' });
  t.after(async () => { await client.close().catch(() => {}); fs.rmSync(state, { recursive: true, force: true }); });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 7);
  assert.ok(!tools.tools.some(row => /context|checkpoint|trace|release|team/.test(row.name)));
  const status = await client.callTool({ name: 'livingstack.status', arguments: {} });
  assert.equal(status.structuredContent.edition, 'community-proof-loop');
  assert.equal(status.structuredContent.tool_count, 7);
  const resources = await client.listResources();
  assert.deepEqual(resources.resources.map(row => row.uri), ['livingstack://capabilities']);
});
