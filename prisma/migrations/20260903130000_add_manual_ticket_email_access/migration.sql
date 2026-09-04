ALTER TABLE "EventTicketSale"
  ADD COLUMN "buyerEmail" TEXT,
  ADD COLUMN "accessToken" TEXT;

CREATE UNIQUE INDEX "EventTicketSale_accessToken_key"
  ON "EventTicketSale"("accessToken");
