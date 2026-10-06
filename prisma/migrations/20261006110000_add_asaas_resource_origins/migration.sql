CREATE TYPE "AsaasResourceOriginType" AS ENUM ('SUBSCRIPTION', 'PAYMENT', 'INSTALLMENT');
CREATE TYPE "AsaasResourceOriginValue" AS ENUM ('ALUSA', 'EXTERNAL');

CREATE TABLE "AsaasResourceOrigin" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "resourceType" "AsaasResourceOriginType" NOT NULL,
  "asaasId" TEXT NOT NULL,
  "origin" "AsaasResourceOriginValue" NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "history" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AsaasResourceOrigin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AsaasResourceOrigin_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_asaas_resource_origin_tenant_resource" ON "AsaasResourceOrigin"("contaId", "resourceType", "asaasId");
CREATE INDEX "idx_asaas_resource_origin_tenant_origin" ON "AsaasResourceOrigin"("contaId", "origin", "resourceType", "classifiedAt");
