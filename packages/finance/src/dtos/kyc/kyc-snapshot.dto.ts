import type { MyAccountKycAreaStatus } from '@alusa/asaas';
import type { KycProcessStatus } from '@prisma/client';

// ── Status normalizados ──────────────────────────────────────────────────

export type KycAreaStatus = 'APPROVED' | 'PENDING' | 'AWAITING_APPROVAL' | 'REJECTED' | 'NOT_SENT' | 'UNKNOWN';

export type KycNextActionKind =
  | 'EXTERNAL_ONBOARDING'
  | 'UPLOAD_DOCUMENT'
  | 'PROVIDER_PORTAL_REQUIRED'
  | 'WAITING_PROVIDER'
  | 'PROVISIONING_TIMEOUT';

/** Status de confirmação anual de dados comerciais (commercial info). */
export type CommercialInfoStatus = 'EXPIRING_SOON' | 'EXPIRED';

export type CommercialInfoExpiration = {
  isExpired: boolean;
  scheduledDate: string | null;
};

// ── Account Verification (BFF layer) ────────────────────────────────────

/**
 * Estados de produto da conta — expostos ao frontend.
 * Mapeados a partir dos 8 `KycProcessStatus` internos do Prisma.
 */
export type AccountVerificationStatus =
  | 'ACCOUNT_PENDING_ACTIVATION'
  | 'ACCOUNT_PENDING_USER_ACTION'
  | 'ACCOUNT_UNDER_REVIEW'
  | 'ACCOUNT_REQUIRES_CORRECTION'
  | 'ACCOUNT_ACTIVE';

/** Modo de envio de documento decidido pelo backend com base no payload real do Asaas */
export type VerificationActionMode =
  | 'REDIRECT'
  | 'UPLOAD'
  | 'PROVIDER_PORTAL_REQUIRED'
  | 'WAITING_PROVIDER'
  | 'PROVISIONING_TIMEOUT';

export type VerificationActionStatus = 'PENDING' | 'REJECTED';

/** Ação concreta de verificação de documento — 1 grupo = 1 ação */
export type VerificationAction = {
  id: string;
  label: string;
  /** Descrição filtrada: só presente quando é conteúdo real do Asaas (não template). */
  description?: string;
  mode: VerificationActionMode;
  status: VerificationActionStatus;
  /** Tipo do grupo/documento conforme Asaas (ex.: IDENTIFICATION, MEI_CERTIFICATE). */
  documentType?: string | null;
  /** Tipo sugerido do documento para upload (quando mode === 'UPLOAD'). */
  uploadType?: string | null;
  /** Obrigatório quando mode === 'REDIRECT' */
  redirectUrl?: string;
  redirectUrlExpirationDate?: string | null;
  isRedirectExpired?: boolean;
  /** Obrigatório quando mode === 'UPLOAD' */
  uploadGroupId?: string;
  /** Indica qual método de submissão foi derivado pelo backend: 'EXTERNAL_ONBOARDING_URL' | 'INTERNAL_UPLOAD'. */
  submissionMethod?: 'EXTERNAL_ONBOARDING_URL' | 'INTERNAL_UPLOAD';
  /** Documentos já enviados neste grupo (status de cada arquivo). */
  slots?: VerificationSlotInfo[];
  /** Responsável pelo envio (nome + tipo), conforme retornado pelo Asaas. */
  responsible?: { name?: string; type?: string } | null;
};

/** Slot individual dentro de uma ação (ex.: Frente, Verso) */
export type VerificationSlotInfo = {
  id: string;
  label: string;
  status: string;
};

/** Status de cada uma das 4 áreas de verificação */
export type VerificationAreaInfo = {
  key: string;
  label: string;
  description: string;
  status: KycAreaStatus;
};

/** Resposta do endpoint GET /api/account/verification-status */
export type AccountVerificationResponse = {
  status: AccountVerificationStatus;
  actions: VerificationAction[];
  areas: VerificationAreaInfo[];
  commercialInfoStatus: CommercialInfoStatus | null;
  commercialInfoScheduledDate: string | null;
  commercialInfoExpiration: CommercialInfoExpiration | null;
  rejectReasons: string[];
  fetchedAt: string;
  /** true quando o ambiente Asaas é sandbox. */
  isSandbox: boolean;
};

/**
 * Mapeia os 8 estados internos (KycProcessStatus do Prisma) para os 5 estados de produto.
 */
export function mapProcessToAccountStatus(processStatus: KycProcessStatus): AccountVerificationStatus {
  switch (processStatus) {
    case 'NOT_STARTED':
    case 'WAITING_MIN_TIMEOUT':
      return 'ACCOUNT_PENDING_ACTIVATION';
    case 'PENDING_DOCUMENTS':
    case 'EXTERNAL_IN_PROGRESS':
    case 'INTERNAL_UPLOADING':
      return 'ACCOUNT_PENDING_USER_ACTION';
    case 'UNDER_REVIEW':
      return 'ACCOUNT_UNDER_REVIEW';
    case 'REJECTED':
      return 'ACCOUNT_REQUIRES_CORRECTION';
    case 'APPROVED':
      return 'ACCOUNT_ACTIVE';
    default:
      return 'ACCOUNT_PENDING_USER_ACTION';
  }
}

export type KycSlotInfo = {
  id: string;
  label: string;
  status: string;
};

// ── Next-action derivada de cada grupo pendente ──────────────────────────

export type KycNextAction = {
  kind: KycNextActionKind;
  groupId: string;
  /** Status do grupo no Asaas (NOT_SENT | REJECTED | PENDING | APPROVED | IGNORED). Usado para derivar status da action. */
  groupStatus?: string;
  type: string | null;
  title: string;
  /** Descrição filtrada: só presente quando é conteúdo real do Asaas (não template genérico). */
  description?: string;
  /** Presente apenas quando kind === 'EXTERNAL_ONBOARDING'. Buscado fresh (nunca de cache). */
  onboardingUrl?: string;
  /** Presente apenas quando kind === 'EXTERNAL_ONBOARDING' e disponível no Asaas (fresh-only). */
  onboardingUrlExpirationDate?: string | null;
  /** Derivado de onboardingUrlExpirationDate (fresh-only). */
  isOnboardingUrlExpired?: boolean;
  /** Modo de submissão derivado: 'EXTERNAL_ONBOARDING_URL' | 'INTERNAL_UPLOAD'. */
  submissionMethod?: 'EXTERNAL_ONBOARDING_URL' | 'INTERNAL_UPLOAD';
  /** Slots individuais do grupo (ex.: Frente/Verso para IDENTIFICATION com 2 docs). */
  slots?: KycSlotInfo[];
  /** Responsável pelo envio (do payload do Asaas). */
  responsible?: { name?: string; type?: string } | null;
};

// ── Snapshot canônico ────────────────────────────────────────────────────

export type KycSnapshot = {
  generalStatus: KycAreaStatus;
  documentationStatus: KycAreaStatus;
  bankAccountStatus: KycAreaStatus;
  commercialInfoAreaStatus: KycAreaStatus;

  /**
   * Status granular do processo KYC.
   * @derived Calculado internamente a partir de generalStatus + documentationStatus + grupos de documentos.
   * NÃO é um valor retornado diretamente pela API do Asaas — é uma conveniência para a UI.
   * Valores possíveis: NOT_STARTED | PENDING_DOCUMENTS | EXTERNAL_IN_PROGRESS |
   * INTERNAL_UPLOADING | UNDER_REVIEW | REJECTED | APPROVED
   */
  processStatus: KycProcessStatus;

  /**
   * Status de confirmação anual de dados comerciais (webhook ACCOUNT_STATUS_COMMERCIAL_INFO_*).
   * Não representa rejeição de KYC documental — é independente de documentationStatus.
   */
  commercialInfoStatus: CommercialInfoStatus | null;
  commercialInfoScheduledDate: string | null;
  commercialInfoExpiration: CommercialInfoExpiration | null;

  /**
   * true quando qualquer uma das 3 áreas (general/documentation/bankAccount) não é APPROVED.
   * Usado como gate obrigatório para mutações financeiras.
   */
  hasBlockingPending: boolean;

  /** Ações concretas derivadas de GET /myAccount/documents. */
  nextActions: KycNextAction[];

  /** Motivos de rejeição retornados pelo Asaas, quando houver. */
  rejectReasons: string[];

  /** ISO timestamp de quando o snapshot foi gerado. */
  fetchedAt: string;

  /** true quando o ambiente Asaas é sandbox. Permite ao frontend oferecer fallbacks exclusivos do sandbox. */
  isSandbox: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Textos genéricos de template que o Asaas retorna como description
 * quando a subconta ainda não foi totalmente provisionada.
 * Esses textos não agregam valor ao usuário — filtramos para evitar
 * exibir instruções que o Asaas usa como placeholder.
 */
const ASAAS_TEMPLATE_DESCRIPTIONS = new Set([
  'Para enviar esse documento acesse nosso aplicativo ou utilize o link de onboarding.',
  'No description',
]);

/**
 * Indicadores de que o grupo de documento pertence a uma subconta padrão (não-BaaS)
 * e que o upload via API NÃO é permitido.
 *
 * O Asaas retorna essas descriptions quando a subconta não está no fluxo White Label/BaaS.
 * Nesse caso, o envio deve ocorrer diretamente pela interface do Asaas.
 *
 * @see https://docs.asaas.com/docs/detalhamento-do-fluxo-de-aprova%C3%A7%C3%A3o-de-subcontas
 */
const ASAAS_INTERFACE_ONLY_INDICATORS = new Set([
  'Para enviar esse documento acesse nosso aplicativo ou utilize o link de onboarding.',
]);

/**
 * Verifica se a description de um grupo indica que o upload via API não é aceito.
 * Subcontas padrão (não-BaaS) retornam essa description quando onboardingUrl é null.
 */
export function isAsaasInterfaceOnlyDescription(description: string | undefined | null): boolean {
  if (!description) return false;
  return ASAAS_INTERFACE_ONLY_INDICATORS.has(description.trim());
}

export function filterTemplateDescription(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (ASAAS_TEMPLATE_DESCRIPTIONS.has(trimmed)) return undefined;
  return trimmed;
}

export function normalizeAreaStatus(raw: MyAccountKycAreaStatus | string | null | undefined): KycAreaStatus {
  const upper = (raw ?? '').trim().toUpperCase();
  if (upper === 'APPROVED') return 'APPROVED';
  if (upper === 'REJECTED') return 'REJECTED';
  if (upper === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
  if (upper === 'PENDING') return 'PENDING';
  if (upper === 'NOT_SENT') return 'NOT_SENT';
  return 'UNKNOWN';
}

const BLOCKED_STATUSES = new Set<KycAreaStatus>(['PENDING', 'NOT_SENT', 'REJECTED', 'AWAITING_APPROVAL', 'UNKNOWN']);

export function isAreaBlocking(status: KycAreaStatus): boolean {
  return BLOCKED_STATUSES.has(status);
}
