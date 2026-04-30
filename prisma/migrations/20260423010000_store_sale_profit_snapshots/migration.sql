-- Add immutable cost/profit snapshots for store sales.
-- Existing rows remain NULL because historical profit cannot be reconstructed safely
-- after average inventory cost changes.

ALTER TABLE "Sale"
  ADD COLUMN "totalCost" DECIMAL(12,2),
  ADD COLUMN "grossProfit" DECIMAL(12,2),
  ADD COLUMN "grossMargin" DECIMAL(9,4);

ALTER TABLE "SaleItem"
  ADD COLUMN "unitCostAtSale" DECIMAL(12,4),
  ADD COLUMN "totalCostAtSale" DECIMAL(12,2),
  ADD COLUMN "discountShareAtSale" DECIMAL(12,2),
  ADD COLUMN "netSubtotalAtSale" DECIMAL(12,2),
  ADD COLUMN "grossProfitAtSale" DECIMAL(12,2),
  ADD COLUMN "marginAtSale" DECIMAL(9,4);
