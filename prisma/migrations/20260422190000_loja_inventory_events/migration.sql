-- CreateEnum
CREATE TYPE "SaleInventoryMode" AS ENUM ('IMMEDIATE', 'RESERVE');

-- CreateEnum
CREATE TYPE "SaleInventoryStatus" AS ENUM ('FULFILLED', 'RESERVED', 'CANCELED', 'RETURNED_PARTIAL', 'RETURNED_TOTAL');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM (
  'OPENING_IN',
  'ENTRY_IN',
  'RESTOCK_IN',
  'SALE_OUT',
  'RESERVE',
  'RELEASE',
  'RETURN_IN',
  'ADJUST_IN',
  'ADJUST_OUT',
  'LOSS_OUT'
);

-- CreateEnum
CREATE TYPE "RestockOrderStatus" AS ENUM ('PLANEJADO', 'RECEBIDO_PARCIAL', 'RECEBIDO', 'CANCELADO');

-- AlterTable
ALTER TABLE "Sale"
  ADD COLUMN "inventoryMode" "SaleInventoryMode" NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN "inventoryStatus" "SaleInventoryStatus" NOT NULL DEFAULT 'FULFILLED';

-- AlterTable
ALTER TABLE "SaleItem"
  ADD COLUMN "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryBalance" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "inventoryItemKey" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "onHand" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "incoming" INTEGER NOT NULL DEFAULT 0,
  "averageCost" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "inventoryItemKey" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "movementType" "InventoryMovementType" NOT NULL,
  "onHandBefore" INTEGER NOT NULL,
  "onHandDelta" INTEGER NOT NULL,
  "onHandAfter" INTEGER NOT NULL,
  "reservedBefore" INTEGER NOT NULL,
  "reservedDelta" INTEGER NOT NULL,
  "reservedAfter" INTEGER NOT NULL,
  "incomingBefore" INTEGER NOT NULL,
  "incomingDelta" INTEGER NOT NULL,
  "incomingAfter" INTEGER NOT NULL,
  "unitCost" DECIMAL(12,4),
  "totalCost" DECIMAL(14,4),
  "originType" TEXT NOT NULL,
  "originId" TEXT NOT NULL,
  "originLineId" TEXT NOT NULL DEFAULT 'ROOT',
  "originActionKey" TEXT NOT NULL,
  "actorUserId" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockOrder" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "status" "RestockOrderStatus" NOT NULL DEFAULT 'PLANEJADO',
  "supplierName" TEXT,
  "expectedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "canceledAt" TIMESTAMP(3),
  "canceledReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RestockOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestockOrderItem" (
  "id" TEXT NOT NULL,
  "restockOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "quantityExpected" INTEGER NOT NULL,
  "quantityReceived" INTEGER NOT NULL DEFAULT 0,
  "estimatedUnitCost" DECIMAL(12,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RestockOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_contaId_inventoryItemKey_key" ON "InventoryBalance"("contaId", "inventoryItemKey");

-- CreateIndex
CREATE INDEX "InventoryBalance_contaId_idx" ON "InventoryBalance"("contaId");

-- CreateIndex
CREATE INDEX "InventoryBalance_productId_idx" ON "InventoryBalance"("productId");

-- CreateIndex
CREATE INDEX "InventoryBalance_variantId_idx" ON "InventoryBalance"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_variantId_key" ON "InventoryBalance"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_contaId_originType_originId_originLineId_originActionKey_movementType_key"
  ON "InventoryMovement"("contaId", "originType", "originId", "originLineId", "originActionKey", "movementType");

-- CreateIndex
CREATE INDEX "InventoryMovement_contaId_idx" ON "InventoryMovement"("contaId");

-- CreateIndex
CREATE INDEX "InventoryMovement_productId_idx" ON "InventoryMovement"("productId");

-- CreateIndex
CREATE INDEX "InventoryMovement_variantId_idx" ON "InventoryMovement"("variantId");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_movementType_idx" ON "InventoryMovement"("movementType");

-- CreateIndex
CREATE INDEX "RestockOrder_contaId_idx" ON "RestockOrder"("contaId");

-- CreateIndex
CREATE INDEX "RestockOrder_contaId_status_idx" ON "RestockOrder"("contaId", "status");

-- CreateIndex
CREATE INDEX "RestockOrder_expectedAt_idx" ON "RestockOrder"("expectedAt");

-- CreateIndex
CREATE INDEX "RestockOrderItem_restockOrderId_idx" ON "RestockOrderItem"("restockOrderId");

-- CreateIndex
CREATE INDEX "RestockOrderItem_productId_idx" ON "RestockOrderItem"("productId");

-- CreateIndex
CREATE INDEX "RestockOrderItem_variantId_idx" ON "RestockOrderItem"("variantId");

-- AddForeignKey
ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "Usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockOrder"
  ADD CONSTRAINT "RestockOrder_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockOrder"
  ADD CONSTRAINT "RestockOrder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Usuario"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockOrderItem"
  ADD CONSTRAINT "RestockOrderItem_restockOrderId_fkey"
  FOREIGN KEY ("restockOrderId") REFERENCES "RestockOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockOrderItem"
  ADD CONSTRAINT "RestockOrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestockOrderItem"
  ADD CONSTRAINT "RestockOrderItem_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: produto simples sem variantes
INSERT INTO "InventoryBalance" (
  "id",
  "contaId",
  "inventoryItemKey",
  "productId",
  "variantId",
  "onHand",
  "reserved",
  "incoming",
  "averageCost",
  "createdAt",
  "updatedAt"
)
SELECT
  'invbal_' || md5('product:' || p."id"),
  p."contaId",
  'product:' || p."id",
  p."id",
  NULL,
  p."stock",
  0,
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product" p
WHERE NOT EXISTS (
  SELECT 1
  FROM "ProductVariant" pv
  WHERE pv."productId" = p."id"
)
ON CONFLICT ("contaId", "inventoryItemKey") DO NOTHING;

-- Backfill: variantes são a única fonte quando existem
INSERT INTO "InventoryBalance" (
  "id",
  "contaId",
  "inventoryItemKey",
  "productId",
  "variantId",
  "onHand",
  "reserved",
  "incoming",
  "averageCost",
  "createdAt",
  "updatedAt"
)
SELECT
  'invbal_' || md5('variant:' || pv."id"),
  p."contaId",
  'variant:' || pv."id",
  pv."productId",
  pv."id",
  pv."stock",
  0,
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "ProductVariant" pv
INNER JOIN "Product" p ON p."id" = pv."productId"
ON CONFLICT ("contaId", "inventoryItemKey") DO NOTHING;

-- Backfill: movimentos de abertura
INSERT INTO "InventoryMovement" (
  "id",
  "contaId",
  "inventoryItemKey",
  "productId",
  "variantId",
  "movementType",
  "onHandBefore",
  "onHandDelta",
  "onHandAfter",
  "reservedBefore",
  "reservedDelta",
  "reservedAfter",
  "incomingBefore",
  "incomingDelta",
  "incomingAfter",
  "unitCost",
  "totalCost",
  "originType",
  "originId",
  "originLineId",
  "originActionKey",
  "actorUserId",
  "reason",
  "createdAt"
)
SELECT
  'invmv_' || md5('opening:' || ib."inventoryItemKey"),
  ib."contaId",
  ib."inventoryItemKey",
  ib."productId",
  ib."variantId",
  'OPENING_IN',
  0,
  ib."onHand",
  ib."onHand",
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  'BACKFILL',
  ib."inventoryItemKey",
  'ROOT',
  'initial',
  NULL,
  'Backfill de estoque legado',
  CURRENT_TIMESTAMP
FROM "InventoryBalance" ib
ON CONFLICT ("contaId", "originType", "originId", "originLineId", "originActionKey", "movementType") DO NOTHING;

-- Produto pai com variantes não reaproveita mais o saldo legado direto
UPDATE "Product"
SET "stock" = 0,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "ProductVariant" pv
  WHERE pv."productId" = "Product"."id"
);

-- Vendas canceladas ganham status de estoque cancelado
UPDATE "Sale"
SET "inventoryStatus" = 'CANCELED'
WHERE "status" = 'CANCELADA';
