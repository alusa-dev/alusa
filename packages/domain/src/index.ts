// Regras de matrícula
export {
  calcularIdadeMinima,
  calcularIdadeMaxima,
  calcularIdade,
  isMenorDeIdade,
  precisaResponsavelFinanceiro,
  resolvePayer,
  valorMinimoMensalidade,
  descontoMaximoPermitido,
} from './rules/matricula-rules.js';

export type {
  PayerType,
  PayerRef,
  ResolvePayerInput,
  ResolvePayerResult,
} from './rules/matricula-rules.js';

// Regras de rematrícula
export {
  validarCapacidadeRematricula,
  validarConflitosRematricula,
  validarDatasRematricula,
  DIAS_MAXIMOS_CONTRATO_EXPIRADO_REMATRICULA,
  validarElegibilidadeRematricula,
} from './rules/rematricula-rules.js';

export type {
  TurmaInfo,
  ValidarCapacidadeInput,
  ValidarCapacidadeResult,
  TurmaHorario,
  ValidarConflitosInput,
  ValidarConflitosResult,
  ValidarDatasInput,
  ValidarDatasResult,
  ValidarElegibilidadeInput,
  ValidarElegibilidadeResult,
} from './rules/rematricula-rules.js';

export {
  buildRenewalPreview,
  buildRenewalSourceVersion,
  calculateRenewalEffectiveAt,
  canTransitionRenewalProcess,
} from './rules/renewal-process.js';

export type {
  BuildRenewalPreviewInput,
  RenewalDecision,
  RenewalHolderType,
  RenewalItemInput,
  RenewalOrigin,
  RenewalPreview,
  RenewalPreviewBlocker,
  RenewalProcessStatus,
  RenewalSourceEnrollment,
  RenewalTargetType,
} from './rules/renewal-process.js';

// Máquina de estados de matrícula
export {
  isTerminalStatus,
  canTransition,
  validateTransition,
  occupiesSeat,
  occupiesSeatWithPause,
  getSeatOccupyingStatuses as getDomainSeatOccupyingStatuses,
  isElegivelRematricula,
  canEditStructural,
  getTerminalStatuses,
  getValidTransitions,
  validatePausa,
  validateReativacao,
} from './rules/matricula-state-machine.js';

export type {
  TransitionResult,
  PausaValidationResult,
  ReativacaoValidationResult,
} from './rules/matricula-state-machine.js';

// Motor de validação unificado
export {
  validarCapacidade,
  validarConflitosHorario,
  validarDatasContrato,
} from './rules/validation-engine.js';

export type {
  TurmaCapacidadeInfo,
  ValidarCapacidadeResult as UnifiedCapacidadeResult,
  HorarioTurma,
  ValidarConflitosResult as UnifiedConflitosResult,
  ValidarDatasContratoResult,
} from './rules/validation-engine.js';

// Eventos escolares
export * from './events/index.js';
export * from './events/map/map-rules.js';

// Contratos eletrônicos
export * from './value-objects/cpf.js';
export * from './contracts/signature-payload.js';
export * from './contracts/validate-contract-signer.js';

// DTOs formais do domínio
export * from './dtos/index.js';

// Privacidade e LGPD
export * from './privacy/privacy-request-state-machine.js';
export * from './privacy/consent-rules.js';

// Nova engine decoplada do mapa de eventos
export * from './map-engine/index.js';
