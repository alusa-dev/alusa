import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256.js';

describe('browser-safe SHA-256', () => {
  it('matches the SHA-256 digest for text and equivalent UTF-8 bytes', () => {
    const text = 'abc';
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

    expect(sha256Hex(text)).toBe(expected);
    expect(sha256Hex(new TextEncoder().encode(text))).toBe(expected);
  });
});
