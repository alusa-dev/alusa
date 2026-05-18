// Inicializa mapa de erros em PT-BR para Zod
import './zod-error-map';

export * from './hooks/useIsClient';
export * from './math';
export * from './alunos/aluno.schema';
export * from './alunos/aluno.service';
// Aluno Archive Policy
export * from './alunos/policies';
// export * from './services/matricula'; // TODO: Fase 2 - refatorar para usar @alusa/asaas
// export * from './services/rematricula'; // TODO: Fase 2 - refatorar para usar @alusa/asaas
// Turmas
export * from './schemas/turma.schema';
export * from './services/turma.service';
// Modalidades e Salas
export * from './schemas/modalidade.schema';
export * from './schemas/sala.schema';
export * from './services/modalidade.service';
export * from './services/sala.service';
export * from './services/notifications.service';
export * from './notifications/emit-billing-notifications';
export * from './notifications/pending-inbox-notifications';
export * from './notifications/process-overdue-billing';
export * from './notifications/domain-notifications';
export * from './notifications/inbox-metrics';
export * from './notifications/tenant-notification-preferences';
export * from './prisma';
// Planos
export * from './planos/planos-schema';
export * from './planos/planos-service';
// Combos
export * from './combos/combo.schema';
export * from './combos/combo.service';
// Produtos / Categorias (Vendas/Loja)
export * from './schemas/product.schema';
export * from './schemas/category.schema';
export * from './services/product.service';
export * from './services/product-option.service';
export * from './services/product-variant.service';
export * from './services/category.service';
// Professores
export * from './validators/professor';
export * from './schemas/professor';
export * as ProfessorRepo from './server/repositories/professor-repo';
export * as ProfessorService from './server/services/professor-service';
// Colaboradores
export * from './schemas/colaborador';
export * as ColaboradorService from './server/services/colaborador-service';
// Convites
export * as InviteUserService from './server/services/invite-user-service';
// Utils de convite
export { buildInviteUrl } from './invite/build-invite-url';
// Utils
export * from './utils/format-name';
export * from './utils/mask';
export * from './utils/cpf-cnpj';
export * from './utils/date-only';
// Integrações / Credenciais
export * from './services/integracoes/asaas-credentials-service';
export * from './services/integracoes/asaas-notifications.service';
export * from './services/asaas/ensure-asaas-customer';
// Sincronização de Matrículas
// TODO: Fase 2 - refatorar matricula-sync para usar @alusa/asaas
// export {
//   syncMatriculaStatus,
//   resendTaxaMatricula,
//   ManualSyncError,
//   type SyncMatriculaStatusInput,
//   type SyncMatriculaStatusResult,
//   type ResendTaxaMatriculaInput,
//   type ResendTaxaMatriculaResult,
// } from './services/integracoes/matricula-sync.service';

// Ocupação de Vagas (Matrícula)
export {
  doesMatriculaOccupySeat,
  getSeatOccupyingStatuses,
  buildSeatOccupancyWhereClause,
  calcularVagasDisponiveis,
  SEAT_OCCUPYING_STATUSES,
  NON_SEAT_OCCUPYING_STATUSES,
} from './services/matricula-occupancy';

// Jobs
export {
  encerrarContratosExpirados,
  listarContratosProximosDeExpirar,
  type EncerrarContratosResult,
} from './jobs/encerrar-contratos-expirados';
export { notifyContractsExpiring } from './jobs/notify-contracts-expiring';
export { processPendingInboxNotifications } from './notifications/pending-inbox-notifications';
export {
  notifyMatriculaAction,
  type NotifyMatriculaActionInput,
  type NotificationResult as MatriculaNotificationResult,
} from './notifications/matricula-notifications';
