-- Configure fiscal invoiceSettings timing without changing existing behavior.
CREATE TYPE "FiscalInvoiceEffectiveDatePeriod" AS ENUM (
  'ON_PAYMENT_CONFIRMATION',
  'ON_PAYMENT_DUE_DATE',
  'BEFORE_PAYMENT_DUE_DATE',
  'ON_DUE_DATE_MONTH',
  'ON_NEXT_MONTH'
);

ALTER TABLE "ContaFiscalSettings"
  ADD COLUMN "invoiceEffectiveDatePeriod" "FiscalInvoiceEffectiveDatePeriod" NOT NULL DEFAULT 'ON_PAYMENT_CONFIRMATION',
  ADD COLUMN "invoiceDaysBeforeDueDate" INTEGER,
  ADD COLUMN "invoiceReceivedOnly" BOOLEAN NOT NULL DEFAULT true;
