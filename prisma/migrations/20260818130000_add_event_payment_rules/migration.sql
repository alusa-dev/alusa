-- Persist optional event-level payment rules and the immutable rules snapshot
-- captured when an event participant is registered.
ALTER TABLE "SchoolEvent"
  ADD COLUMN "paymentInterestValue" DECIMAL(12, 2),
  ADD COLUMN "paymentFineValue" DECIMAL(12, 2),
  ADD COLUMN "paymentFineType" TEXT,
  ADD COLUMN "paymentDiscountValue" DECIMAL(12, 2),
  ADD COLUMN "paymentDiscountType" TEXT,
  ADD COLUMN "paymentDiscountDueDateLimitDays" INTEGER;

ALTER TABLE "EventParticipant"
  ADD COLUMN "registrationPaymentRules" JSONB;
