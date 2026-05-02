-- Indexes for dashboard, billing and student list read paths.
CREATE INDEX "idx_aluno_conta_status" ON "Aluno"("contaId", "status");
CREATE INDEX "idx_aluno_conta_created_at" ON "Aluno"("contaId", "createdAt");

CREATE INDEX "idx_calendar_event_conta_range" ON "CalendarEvent"("contaId", "startAt", "endAt");

CREATE INDEX "idx_matricula_status_created_at" ON "Matricula"("status", "createdAt");
CREATE INDEX "idx_matricula_status_updated_at" ON "Matricula"("status", "updatedAt");

CREATE INDEX "idx_cobranca_status_vencimento" ON "Cobranca"("status", "vencimento");
CREATE INDEX "idx_cobranca_tipo_status_data_pagamento" ON "Cobranca"("tipo", "status", "dataPagamento");
CREATE INDEX "idx_cobranca_created_at" ON "Cobranca"("createdAt");

CREATE INDEX "idx_pagamento_status_data_pagamento" ON "Pagamento"("status", "dataPagamento");
