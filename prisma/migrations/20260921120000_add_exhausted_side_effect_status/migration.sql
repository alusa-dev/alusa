-- Additive, backward-compatible state for side effects that exhausted retries.
-- Existing FAILED rows remain readable and are promoted by the worker's
-- reconciliation pass when they have reached the retry limit.
ALTER TYPE "FinanceWebhookSideEffectStatus" ADD VALUE 'EXHAUSTED';
