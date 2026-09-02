import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const stage = path.join(root, '.dist', 'mcpb');
const tarball = path.join(root, `living-stack-community-${pkg.version}.tgz`);
const output = path.join(root, `living-stack-community-${pkg.version}.mcpb`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}

rmSync(stage, { recursive: true, force: true });
rmSync(output, { force: true });
mkdirSync(path.join(stage, 'assets'), { recursive: true });
cpSync(path.join(root, 'packaging', 'mcpb', 'manifest.json'), path.join(stage, 'manifest.json'));
cpSync(path.join(root, 'assets', 'living-stack-icon-192.png'), path.join(stage, 'assets', 'living-stack-icon-192.png'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('run through npm run mcpb:build');
run(process.execPath, [npmCli, 'install', tarball, '--prefix', stage, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
run(process.execPath, [npmCli, 'exec', '--yes', '@anthropic-ai/mcpb', '--', 'pack', stage, output]);
const bytes = readFileSync(output);
process.stdout.write(`${JSON.stringify({ decision: 'PASS', artifact: path.basename(output), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2)}\n`);
