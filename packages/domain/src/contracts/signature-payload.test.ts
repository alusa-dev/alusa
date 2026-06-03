import { describe, expect, it } from 'vitest';
import { hashCanonicalPayload, stableStringify } from './signature-payload.js';

describe('contract signature payload', () => {
  it('gera serialização canônica independente da ordem das chaves', () => {
    expect(stableStringify({ b: 2, a: 1, nested: { z: true, c: null } })).toBe(
      '{"a":1,"b":2,"nested":{"c":null,"z":true}}',
    );
  });

  it('gera hash determinístico para evidências e assinatura', () => {
    const left = hashCanonicalPayload({ b: 2, a: { y: 'ok', x: 1 } });
    const right = hashCanonicalPayload({ a: { x: 1, y: 'ok' }, b: 2 });

    expect(left).toBe(right);
    expect(left).toHaveLength(64);
  });
});
