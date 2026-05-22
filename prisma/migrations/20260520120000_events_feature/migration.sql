-- CreateEnum
CREATE TYPE "SchoolEventStatus" AS ENUM ('DRAFT', 'PLANNING', 'ACTIVE', 'FINISHED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SchoolEventType" AS ENUM ('PRESENTATION', 'PARTY', 'GRADUATION', 'TRIP', 'WORKSHOP', 'MEETING', 'CHAMPIONSHIP', 'CULTURAL_SHOW', 'OTHER');

-- CreateEnum
CREATE TYPE "EventTicketType" AS ENUM ('FULL', 'HALF', 'PROMOTIONAL', 'COMPLIMENTARY', 'STUDENT', 'GUARDIAN', 'GUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "EventTicketLotStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SOLD_OUT', 'CLOSED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EventTicketSaleStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED', 'COMPLIMENTARY');

-- CreateEnum
CREATE TYPE "EventPaymentMethod" AS ENUM ('CASH', 'MANUAL_PIX', 'EXTERNAL_CARD', 'TRANSFER', 'COMPLIMENTARY', 'OTHER');

-- CreateEnum
CREATE TYPE "EventCostumeCategory" AS ENUM ('CLOTHING', 'ACCESSORY', 'SHOES', 'PROP', 'COMPLETE_KIT', 'OTHER');

-- CreateEnum
CREATE TYPE "EventCostumeAssignmentStatus" AS ENUM ('PENDING', 'ORDERED', 'RECEIVED', 'DELIVERED', 'RETURNED', 'DAMAGED', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventFinancialEntryType" AS ENUM ('COST', 'REVENUE');

-- CreateEnum
CREATE TYPE "EventFinancialEntryStatus" AS ENUM ('EXPECTED', 'PENDING', 'PAID', 'RECEIVED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "EventFinancialOriginType" AS ENUM ('MANUAL', 'TICKET_SALE', 'COSTUME', 'COSTUME_ASSIGNMENT');

-- CreateEnum
CREATE TYPE "EventParticipantType" AS ENUM ('STUDENT', 'CLASS', 'GUARDIAN', 'GUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "EventReportType" AS ENUM ('GENERAL', 'EVENT', 'COMPARATIVE');

-- CreateTable
CREATE TABLE "SchoolEvent" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "SchoolEventType" NOT NULL,
    "status" "SchoolEventStatus" NOT NULL DEFAULT 'PLANNING',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "locationName" TEXT,
    "locationAddress" TEXT,
    "estimatedCapacity" INTEGER,
    "responsibleUserId" TEXT,
    "hasTickets" BOOLEAN NOT NULL DEFAULT false,
    "hasCostumes" BOOLEAN NOT NULL DEFAULT false,
    "hasFinancialControl" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "SchoolEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTicketLot" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticketType" "EventTicketType" NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quantityTotal" INTEGER NOT NULL,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "saleStartsAt" TIMESTAMP(3),
    "saleEndsAt" TIMESTAMP(3),
    "status" "EventTicketLotStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTicketLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTicketSale" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "alunoId" TEXT,
    "responsavelId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceSnapshot" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "EventPaymentMethod" NOT NULL,
    "status" "EventTicketSaleStatus" NOT NULL DEFAULT 'PENDING',
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "notes" TEXT,
    "revenueEntryId" TEXT,
    "paymentProvider" TEXT,
    "asaasPaymentId" TEXT,
    "paymentStatus" TEXT,
    "providerChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTicketSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCostume" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "EventCostumeCategory" NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "accessories" TEXT,
    "schoolCost" DECIMAL(12,2),
    "chargedValue" DECIMAL(12,2),
    "supplier" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCostume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCostumeAssignment" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "costumeId" TEXT NOT NULL,
    "alunoId" TEXT,
    "turmaId" TEXT,
    "definedSize" TEXT,
    "status" "EventCostumeAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "chargedValue" DECIMAL(12,2),
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "deliveredByUserId" TEXT,
    "notes" TEXT,
    "revenueEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCostumeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventFinancialEntry" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "EventFinancialEntryType" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "supplier" TEXT,
    "originType" "EventFinancialOriginType" NOT NULL DEFAULT 'MANUAL',
    "originId" TEXT,
    "expectedAmount" DECIMAL(12,2) NOT NULL,
    "actualAmount" DECIMAL(12,2),
    "dueDate" TIMESTAMP(3),
    "realizedAt" TIMESTAMP(3),
    "status" "EventFinancialEntryStatus" NOT NULL,
    "paymentMethod" "EventPaymentMethod",
    "proofUrl" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "paymentProvider" TEXT,
    "asaasPaymentId" TEXT,
    "paymentStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventFinancialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "EventParticipantType" NOT NULL,
    "alunoId" TEXT,
    "turmaId" TEXT,
    "responsavelId" TEXT,
    "displayName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventReport" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT,
    "type" "EventReportType" NOT NULL,
    "title" TEXT NOT NULL,
    "filters" JSONB,
    "data" JSONB NOT NULL,
    "generatedByUserId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAudit" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_school_event_conta" ON "SchoolEvent"("contaId");

-- CreateIndex
CREATE INDEX "idx_school_event_conta_status_start" ON "SchoolEvent"("contaId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "idx_school_event_conta_type_start" ON "SchoolEvent"("contaId", "type", "startsAt");

-- CreateIndex
CREATE INDEX "idx_school_event_conta_responsible" ON "SchoolEvent"("contaId", "responsibleUserId");

-- CreateIndex
CREATE INDEX "idx_school_event_conta_created" ON "SchoolEvent"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_event_ticket_lot_conta" ON "EventTicketLot"("contaId");

-- CreateIndex
CREATE INDEX "idx_event_ticket_lot_conta_event_status" ON "EventTicketLot"("contaId", "eventId", "status");

-- CreateIndex
CREATE INDEX "idx_event_ticket_lot_conta_sale_window" ON "EventTicketLot"("contaId", "saleStartsAt", "saleEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventTicketLot_contaId_eventId_name_key" ON "EventTicketLot"("contaId", "eventId", "name");

-- CreateIndex
CREATE INDEX "idx_event_ticket_sale_conta" ON "EventTicketSale"("contaId");

-- CreateIndex
CREATE INDEX "idx_event_ticket_sale_conta_event_status" ON "EventTicketSale"("contaId", "eventId", "status");

-- CreateIndex
CREATE INDEX "idx_event_ticket_sale_conta_lot_status" ON "EventTicketSale"("contaId", "lotId", "status");

-- CreateIndex
CREATE INDEX "idx_event_ticket_sale_conta_sold" ON "EventTicketSale"("contaId", "soldAt");

-- CreateIndex
CREATE INDEX "idx_event_ticket_sale_conta_aluno" ON "EventTicketSale"("contaId", "alunoId");

-- CreateIndex
CREATE INDEX "idx_event_ticket_sale_conta_responsavel" ON "EventTicketSale"("contaId", "responsavelId");

-- CreateIndex
CREATE INDEX "idx_event_ticket_sale_conta_asaas_payment" ON "EventTicketSale"("contaId", "asaasPaymentId");

-- CreateIndex
CREATE INDEX "idx_event_costume_conta" ON "EventCostume"("contaId");

-- CreateIndex
CREATE INDEX "idx_event_costume_conta_event_category" ON "EventCostume"("contaId", "eventId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "EventCostume_contaId_eventId_name_size_key" ON "EventCostume"("contaId", "eventId", "name", "size");

-- CreateIndex
CREATE INDEX "idx_event_costume_assignment_conta" ON "EventCostumeAssignment"("contaId");

-- CreateIndex
CREATE INDEX "idx_event_costume_assignment_conta_event_status" ON "EventCostumeAssignment"("contaId", "eventId", "status");

-- CreateIndex
CREATE INDEX "idx_event_costume_assignment_conta_costume_status" ON "EventCostumeAssignment"("contaId", "costumeId", "status");

-- CreateIndex
CREATE INDEX "idx_event_costume_assignment_conta_aluno" ON "EventCostumeAssignment"("contaId", "alunoId");

-- CreateIndex
CREATE INDEX "idx_event_costume_assignment_conta_turma" ON "EventCostumeAssignment"("contaId", "turmaId");

-- CreateIndex
CREATE UNIQUE INDEX "EventCostumeAssignment_contaId_eventId_alunoId_costumeId_key" ON "EventCostumeAssignment"("contaId", "eventId", "alunoId", "costumeId");

-- CreateIndex
CREATE INDEX "idx_event_financial_entry_conta" ON "EventFinancialEntry"("contaId");

-- CreateIndex
CREATE INDEX "idx_event_financial_entry_conta_event_type_status" ON "EventFinancialEntry"("contaId", "eventId", "type", "status");

-- CreateIndex
CREATE INDEX "idx_event_financial_entry_conta_event_category" ON "EventFinancialEntry"("contaId", "eventId", "category");

-- CreateIndex
CREATE INDEX "idx_event_financial_entry_conta_realized" ON "EventFinancialEntry"("contaId", "realizedAt");

-- CreateIndex
CREATE INDEX "idx_event_financial_entry_conta_due" ON "EventFinancialEntry"("contaId", "dueDate");

-- CreateIndex
CREATE INDEX "idx_event_financial_entry_conta_asaas_payment" ON "EventFinancialEntry"("contaId", "asaasPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "EventFinancialEntry_contaId_originType_originId_key" ON "EventFinancialEntry"("contaId", "originType", "originId");

-- CreateIndex
CREATE INDEX "idx_event_participant_conta" ON "EventParticipant"("contaId");

-- CreateIndex
CREATE INDEX "idx_event_participant_conta_event_type" ON "EventParticipant"("contaId", "eventId", "type");

-- CreateIndex
CREATE INDEX "idx_event_participant_conta_aluno" ON "EventParticipant"("contaId", "alunoId");

-- CreateIndex
CREATE INDEX "idx_event_participant_conta_turma" ON "EventParticipant"("contaId", "turmaId");

-- CreateIndex
CREATE INDEX "idx_event_participant_conta_responsavel" ON "EventParticipant"("contaId", "responsavelId");

-- CreateIndex
CREATE INDEX "idx_event_report_conta" ON "EventReport"("contaId");

-- CreateIndex
CREATE INDEX "idx_event_report_conta_event_generated" ON "EventReport"("contaId", "eventId", "generatedAt");

-- CreateIndex
CREATE INDEX "idx_event_report_conta_type_generated" ON "EventReport"("contaId", "type", "generatedAt");

-- CreateIndex
CREATE INDEX "idx_event_audit_conta" ON "EventAudit"("contaId");

-- CreateIndex
CREATE INDEX "idx_event_audit_conta_event_created" ON "EventAudit"("contaId", "eventId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_event_audit_conta_entity" ON "EventAudit"("contaId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "idx_event_audit_conta_action" ON "EventAudit"("contaId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "idx_event_audit_conta_actor" ON "EventAudit"("contaId", "actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "SchoolEvent" ADD CONSTRAINT "SchoolEvent_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEvent" ADD CONSTRAINT "SchoolEvent_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEvent" ADD CONSTRAINT "SchoolEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketLot" ADD CONSTRAINT "EventTicketLot_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketLot" ADD CONSTRAINT "EventTicketLot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketSale" ADD CONSTRAINT "EventTicketSale_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketSale" ADD CONSTRAINT "EventTicketSale_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketSale" ADD CONSTRAINT "EventTicketSale_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "EventTicketLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketSale" ADD CONSTRAINT "EventTicketSale_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketSale" ADD CONSTRAINT "EventTicketSale_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTicketSale" ADD CONSTRAINT "EventTicketSale_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCostume" ADD CONSTRAINT "EventCostume_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCostume" ADD CONSTRAINT "EventCostume_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCostumeAssignment" ADD CONSTRAINT "EventCostumeAssignment_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCostumeAssignment" ADD CONSTRAINT "EventCostumeAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCostumeAssignment" ADD CONSTRAINT "EventCostumeAssignment_costumeId_fkey" FOREIGN KEY ("costumeId") REFERENCES "EventCostume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCostumeAssignment" ADD CONSTRAINT "EventCostumeAssignment_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCostumeAssignment" ADD CONSTRAINT "EventCostumeAssignment_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCostumeAssignment" ADD CONSTRAINT "EventCostumeAssignment_deliveredByUserId_fkey" FOREIGN KEY ("deliveredByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFinancialEntry" ADD CONSTRAINT "EventFinancialEntry_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFinancialEntry" ADD CONSTRAINT "EventFinancialEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventFinancialEntry" ADD CONSTRAINT "EventFinancialEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReport" ADD CONSTRAINT "EventReport_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReport" ADD CONSTRAINT "EventReport_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReport" ADD CONSTRAINT "EventReport_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAudit" ADD CONSTRAINT "EventAudit_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAudit" ADD CONSTRAINT "EventAudit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAudit" ADD CONSTRAINT "EventAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
