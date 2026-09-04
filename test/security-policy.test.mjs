import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('security policy uses the enabled private report route for both editions', () => {
  const policy = readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8');
  assert.match(policy, /https:\/\/github\.com\/equinoxaifinance-rgb\/living-stack-community\/security\/advisories\/new/);
  assert.match(policy, /Community or Complete Local reports/);
  assert.doesNotMatch(policy, /public issues?\s+(?:for|to)\s+vulnerabil/iu);
});
