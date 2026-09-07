-- Deterministic financial conflicts must stop automatic retries and await an
-- operator repair (the existing statuses remain backward compatible).
ALTER TYPE "StatusOperacao" ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW';
