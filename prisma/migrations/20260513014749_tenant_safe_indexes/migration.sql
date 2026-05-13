-- AlterTable
ALTER TABLE "UsuarioConta" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "idx_aluno_conta_nome" ON "Aluno"("contaId", "nome");

-- CreateIndex
CREATE INDEX "idx_aluno_conta_updated_at" ON "Aluno"("contaId", "updatedAt");

-- CreateIndex
CREATE INDEX "idx_asaas_job_conta_status_created" ON "AsaasIntegrationJob"("contaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_asaas_job_conta_type_status" ON "AsaasIntegrationJob"("contaId", "type", "status");

-- CreateIndex
CREATE INDEX "idx_attendance_conta_aluno_recorded" ON "AttendanceRecord"("contaId", "alunoId", "recordedAt");

-- CreateIndex
CREATE INDEX "idx_attendance_conta_event" ON "AttendanceRecord"("contaId", "calendarEventId");

-- CreateIndex
CREATE INDEX "idx_attendance_conta_status_recorded" ON "AttendanceRecord"("contaId", "status", "recordedAt");

-- CreateIndex
CREATE INDEX "idx_attendance_conta_recorded_by_created" ON "AttendanceRecord"("contaId", "recordedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_audit_log_conta_created" ON "AuditLog"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_audit_log_actor" ON "AuditLog"("contaId", "actorType", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_audit_log_action" ON "AuditLog"("contaId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "idx_audit_log_entity" ON "AuditLog"("contaId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "idx_calendar_event_conta_tipo_start" ON "CalendarEvent"("contaId", "tipo", "startAt");

-- CreateIndex
CREATE INDEX "idx_calendar_event_conta_status_start" ON "CalendarEvent"("contaId", "status", "startAt");

-- CreateIndex
CREATE INDEX "idx_calendar_event_conta_turma_start" ON "CalendarEvent"("contaId", "turmaId", "startAt");

-- CreateIndex
CREATE INDEX "idx_charge_conta_status_created" ON "Charge"("contaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_charge_conta_asaas_payment" ON "Charge"("contaId", "asaasPaymentId");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_status_created" ON "ChargeReadModel"("contaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_origin_status_created" ON "ChargeReadModel"("contaId", "origin", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_type_status_created" ON "ChargeReadModel"("contaId", "chargeType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_main_listing" ON "ChargeReadModel"("contaId", "origin", "chargeType", "isGroup", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_payer" ON "ChargeReadModel"("contaId", "payerName");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_asaas_payment" ON "ChargeReadModel"("contaId", "asaasPaymentId");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_matricula" ON "ChargeReadModel"("contaId", "matriculaId");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_aluno" ON "ChargeReadModel"("contaId", "alunoId");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_link_status" ON "ChargeReadModel"("contaId", "linkStatus");

-- CreateIndex
CREATE INDEX "idx_charge_read_model_conta_projected" ON "ChargeReadModel"("contaId", "projectedAt");

-- CreateIndex
CREATE INDEX "idx_family_billing_outbox_status_available" ON "FamilyBillingOutbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "idx_family_billing_outbox_conta_aggregate" ON "FamilyBillingOutbox"("contaId", "aggregateId");

-- CreateIndex
CREATE INDEX "idx_inventory_balance_conta_product" ON "InventoryBalance"("contaId", "productId");

-- CreateIndex
CREATE INDEX "idx_inventory_balance_conta_variant" ON "InventoryBalance"("contaId", "variantId");

-- CreateIndex
CREATE INDEX "idx_inventory_movement_conta_product_created" ON "InventoryMovement"("contaId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_inventory_movement_conta_variant_created" ON "InventoryMovement"("contaId", "variantId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_inventory_movement_conta_type_created" ON "InventoryMovement"("contaId", "movementType", "createdAt");

-- CreateIndex
CREATE INDEX "idx_inventory_movement_conta_actor_created" ON "InventoryMovement"("contaId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_lancamento_conta_status_prevista" ON "Lancamento"("contaId", "status", "dataPrevista");

-- CreateIndex
CREATE INDEX "idx_lancamento_conta_created" ON "Lancamento"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_conta_created" ON "LogFinanceiro"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_conta_usuario_created" ON "LogFinanceiro"("contaId", "usuarioId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_conta_acao_created" ON "LogFinanceiro"("contaId", "acao", "createdAt");

-- CreateIndex
CREATE INDEX "idx_logfinanceiro_conta_cobranca" ON "LogFinanceiro"("contaId", "cobrancaId");

-- CreateIndex
CREATE INDEX "idx_logintegracao_conta_status_created" ON "LogIntegracao"("contaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_logintegracao_conta_entidade" ON "LogIntegracao"("contaId", "entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "idx_logintegracao_conta_asaasid" ON "LogIntegracao"("contaId", "asaasId");

-- CreateIndex
CREATE INDEX "idx_makeup_class_conta_aluno" ON "MakeupClass"("contaId", "alunoId");

-- CreateIndex
CREATE INDEX "idx_makeup_class_conta_status" ON "MakeupClass"("contaId", "status");

-- CreateIndex
CREATE INDEX "idx_makeup_class_conta_turma_origem" ON "MakeupClass"("contaId", "turmaOrigemId");

-- CreateIndex
CREATE INDEX "idx_makeup_class_conta_turma_destino" ON "MakeupClass"("contaId", "turmaDestinoId");

-- CreateIndex
CREATE INDEX "idx_matricula_familiar_conta_status_created" ON "MatriculaFamiliar"("contaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_matricula_familiar_conta_responsavel" ON "MatriculaFamiliar"("contaId", "responsavelId");

-- CreateIndex
CREATE INDEX "idx_operacao_conta_status" ON "MatriculaOperacao"("contaId", "status");

-- CreateIndex
CREATE INDEX "idx_operacao_conta_created" ON "MatriculaOperacao"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_operacao_conta_matricula" ON "MatriculaOperacao"("contaId", "matriculaId");

-- CreateIndex
CREATE INDEX "idx_operacao_conta_correlation" ON "MatriculaOperacao"("contaId", "correlationId");

-- CreateIndex
CREATE INDEX "idx_notification_conta_type_created" ON "Notification"("contaId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "idx_notification_conta_category_created" ON "Notification"("contaId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "idx_notification_conta_severity_created" ON "Notification"("contaId", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "idx_notification_conta_source" ON "Notification"("contaId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "idx_notification_conta_entity" ON "Notification"("contaId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "idx_notification_recipient_feed" ON "NotificationRecipient"("contaId", "userId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "idx_notification_recipient_read" ON "NotificationRecipient"("contaId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "idx_payer_change_operacao_conta_status" ON "PayerChangeOperacao"("contaId", "status");

-- CreateIndex
CREATE INDEX "idx_payer_change_operacao_conta_created" ON "PayerChangeOperacao"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_payer_change_operacao_conta_matricula" ON "PayerChangeOperacao"("contaId", "matriculaId");

-- CreateIndex
CREATE INDEX "idx_payer_change_operacao_conta_correlation" ON "PayerChangeOperacao"("contaId", "correlationId");

-- CreateIndex
CREATE INDEX "idx_product_conta_active" ON "Product"("contaId", "isActive");

-- CreateIndex
CREATE INDEX "idx_product_conta_category" ON "Product"("contaId", "categoryId");

-- CreateIndex
CREATE INDEX "idx_product_conta_name" ON "Product"("contaId", "name");

-- CreateIndex
CREATE INDEX "idx_product_conta_created" ON "Product"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_professor_conta_nome" ON "Professor"("contaId", "nome");

-- CreateIndex
CREATE INDEX "idx_professor_conta_status" ON "Professor"("contaId", "status");

-- CreateIndex
CREATE INDEX "idx_rematricula_familiar_conta_status_created" ON "RematriculaFamiliar"("contaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_rematricula_familiar_conta_responsavel" ON "RematriculaFamiliar"("contaId", "responsavelId");

-- CreateIndex
CREATE INDEX "idx_rematricula_operacao_conta_status" ON "RematriculaOperacao"("contaId", "status");

-- CreateIndex
CREATE INDEX "idx_rematricula_operacao_conta_created" ON "RematriculaOperacao"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_rematricula_operacao_conta_matricula_origem" ON "RematriculaOperacao"("contaId", "matriculaOrigemId");

-- CreateIndex
CREATE INDEX "idx_rematricula_operacao_conta_correlation" ON "RematriculaOperacao"("contaId", "correlationId");

-- CreateIndex
CREATE INDEX "idx_responsavel_conta_nome" ON "Responsavel"("contaId", "nome");

-- CreateIndex
CREATE INDEX "idx_restock_order_conta_expected" ON "RestockOrder"("contaId", "expectedAt");

-- CreateIndex
CREATE INDEX "idx_restock_order_conta_created_by" ON "RestockOrder"("contaId", "createdById");

-- CreateIndex
CREATE INDEX "idx_sale_conta_aluno" ON "Sale"("contaId", "alunoId");

-- CreateIndex
CREATE INDEX "idx_sale_conta_responsavel" ON "Sale"("contaId", "responsavelId");

-- CreateIndex
CREATE INDEX "idx_sale_conta_operador" ON "Sale"("contaId", "operadorId");

-- CreateIndex
CREATE INDEX "idx_turma_conta_status" ON "Turma"("contaId", "status");

-- CreateIndex
CREATE INDEX "idx_turma_conta_created" ON "Turma"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_turma_conta_updated" ON "Turma"("contaId", "updatedAt");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_queue" ON "WebhookAsaas"("status", "nextRetryAt", "recebidoEm");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_tenant_queue" ON "WebhookAsaas"("contaId", "status", "nextRetryAt", "recebidoEm");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_conta_recebido" ON "WebhookAsaas"("contaId", "recebidoEm");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_processado" ON "WebhookAsaas"("processadoEm");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_archive_conta_evento_recebido" ON "WebhookAsaasArchive"("contaId", "evento", "recebidoEm");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_archive_payment" ON "WebhookAsaasArchive"("asaasPaymentId");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_archive_subscription" ON "WebhookAsaasArchive"("asaasSubscriptionId");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_archive_transfer" ON "WebhookAsaasArchive"("asaasTransferId");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_rejection_conta_recebido" ON "WebhookAsaasRejection"("contaId", "recebidoEm");

-- RenameIndex
ALTER INDEX "InventoryMovement_contaId_originType_originId_originLineId_orig" RENAME TO "InventoryMovement_contaId_originType_originId_originLineId__key";
