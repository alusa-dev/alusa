CREATE UNIQUE INDEX "uq_contrato_conta_contract_enrollment"
  ON "Contrato"("contaId", "id", "matriculaId");

ALTER TABLE "ContractEmailNotification"
  DROP CONSTRAINT "ContractEmailNotification_contratoId_fkey",
  DROP CONSTRAINT "ContractEmailNotification_matriculaId_fkey";

ALTER TABLE "ContractEmailNotification"
  ADD CONSTRAINT "ContractEmailNotification_contract_tenant_enrollment_fkey"
    FOREIGN KEY ("contaId", "contratoId", "matriculaId")
    REFERENCES "Contrato"("contaId", "id", "matriculaId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractEmailNotification_matricula_tenant_fkey"
    FOREIGN KEY ("contaId", "matriculaId")
    REFERENCES "Matricula"("contaId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
