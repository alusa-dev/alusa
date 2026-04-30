import { describe, it, expect } from 'vitest';
import { sum } from './math';

describe('math', () => {
  it('sum', () => { expect(sum(1,2)).toBe(3); });
});
