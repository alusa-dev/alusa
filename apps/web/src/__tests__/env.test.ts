import { describe, it, expect } from 'vitest';
import { DATABASE_URL } from '../env';

describe('env', () => {
  it('DATABASE_URL defined (can be empty in CI copy)', () => {
    expect(typeof DATABASE_URL).toBe('string');
  });
});
