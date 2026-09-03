import crypto from 'node:crypto';

export const VERSION = '0.4.1-beta.1';
export const COMMUNITY_TOOLS = Object.freeze([
  'livingstack.status',
  'livingstack.session_start',
  'livingstack.session_status',
  'livingstack.authorize_action',
  'livingstack.record_outcome',
  'livingstack.check_claim',
  'livingstack.session_close',
]);

export const PAID_ONLY_CAPABILITIES = Object.freeze([
  'durable context memory and retrieval',
  'recovery checkpoints',
  'portable Ed25519-signed trace export',
  'release-byte verification',
  'opt-in signed adoption receipts',
  'multi-agent delegation, handoff, shared claims, and coordination',
]);

export function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function cleanText(value, max = 4000) {
  return String(value ?? '')
    .replace(/\b(?:sk|pk|rk|api)[-_][A-Za-z0-9_-]{16,}\b/gi, '[REDACTED]')
    .replace(/\b[A-Fa-f0-9]{64,}\b/g, '[DIGEST]')
    .slice(0, max);
}

export function requireText(value, name, max = 4000) {
  const result = cleanText(value, max).trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}

export function money(value, name = 'amount') {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.round(n * 1e6) / 1e6;
}

export function jsonResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError };
}
