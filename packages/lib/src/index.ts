// Inicializa mapa de erros em PT-BR para Zod
import './zod-error-map';

export * from './hooks/useIsClient';
export * from './math';
export * from './alunos/aluno.schema';
export { digits, nullifyEmpty } from './alunos/map-flatten';
export * from './alunos/aluno.service';
// Aluno Archive Policy
export * from './alunos/policies';
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
export * from './contracts/tokens';
export * from './contracts/evidence/create-contract-evidence';
export * from './contracts/pdf/generate-signed-contract-pdf';
export * from './contracts/providers/signature-provider';
export * from './contracts/use-cases/sign-contract';
// Integrações / Credenciais
export * from './services/integracoes/asaas-credentials-service';

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

// Eventos escolares
export * from './events/events.schema';
export * from './events/events.service';
export * from './events/event-asaas-payment-provider';
export * from './events/map/event-map.schema';
export * from './events/map/event-map.service';
