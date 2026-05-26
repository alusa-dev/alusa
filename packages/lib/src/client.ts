// Entry point seguro para uso em componentes client (não exporta prisma nem serviços server-only)
export * from './hooks/useIsClient';
export * from './math';
// Schemas e utilidades puras
export * from './alunos/aluno.schema';
export * from './schemas/turma.schema';
export * from './schemas/modalidade.schema';
export * from './schemas/sala.schema';
export * from './planos/planos-schema';
export * from './combos/combo.schema';
export * from './validators/professor';
export * from './schemas/professor';
// Utils
export * from './utils/format-name';
export * from './utils/mask'; // Re-exports apenas dos schemas, sem código de servidor
export * from './alunos/aluno.schema';
export * from './validators/professor';
export * from './hooks/useIsClient';
export * from './math';
// utils de convite seguros para client
export { buildInviteUrl } from './invite/build-invite-url';
export { formatNotificationWarningsForUi } from './notifications/format-notification-warnings-for-ui';
