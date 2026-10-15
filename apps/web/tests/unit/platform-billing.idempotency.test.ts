import { describe, expect, it } from 'vitest';
import { platformBillingIdempotencyKeyDTOSchema } from '@/features/platform-billing/dtos';

describe('platform billing idempotency key DTO', () => {
  it('accepts the 128-character limit and rejects longer keys', () => {
    expect(platformBillingIdempotencyKeyDTOSchema.safeParse('k'.repeat(128)).success).toBe(true);
    expect(platformBillingIdempotencyKeyDTOSchema.safeParse('k'.repeat(129)).success).toBe(false);
  });
});
