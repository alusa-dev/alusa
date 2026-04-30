import { describe, it, expect } from 'vitest';
import { useIsClient } from './useIsClient';

// minimal hook test (does not render, just verifies type)
describe('useIsClient', () => {
  it('returns boolean type', () => {
    const fn: () => boolean = useIsClient; // type-level
    expect(typeof fn).toBe('function');
  });
});
