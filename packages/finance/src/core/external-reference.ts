/**
 * External Reference - Padrão canônico para identificação determinística
 * 
 * ADR: Toda cobrança deve ter um externalReference único e determinístico
 * que permita:
 * 1. Identificar o tipo de cobrança (avulsa, assinatura, parcelamento)
 * 2. Rastrear a entidade local correspondente
 * 3. Prevenir duplicidade via idempotência
 * 
 * Formatos V2 (sem subcontaId — subconta é determinada pelo contexto):
 * - Avulsa: alusa:charge:{matriculaId}:{planoId}:{periodo}
 * - Assinatura: alusa:subscription:{matriculaId}:{planoId}
 * - Parcelamento: alusa:installment:{installmentPlanId}
 * - Standalone: alusa:standalone:{chargeId}
 * - Payment específico: alusa:{type}:{parentId}:payment:{asaasPaymentId}
 * 
 * Nota: parsers mantêm retrocompatibilidade com formato antigo (com subcontaId).
 * Limite do Asaas: externalReference ≤ 100 caracteres.
 */

// Limite do Asaas para externalReference
export const ASAAS_MAX_EXTERNAL_REF_LENGTH = 100;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ExternalReferenceType =
  | 'charge'           // Cobrança acadêmica (com matrícula)
  | 'subscription'     // Assinatura recorrente
  | 'installment'      // Parcelamento
  | 'standalone'       // Cobrança avulsa (customer-first)
  | 'payment'          // Payment específico de sub/installment
  | 'unknown';

export interface ParsedExternalReference {
  type: ExternalReferenceType;
  /** IDs extraídos do reference */
  ids: {
    chargeId?: string;
    matriculaId?: string;
    planoId?: string;
    periodo?: string;
    subscriptionId?: string;
    installmentPlanId?: string;
    asaasPaymentId?: string;
    subcontaId?: string;
  };
  /** Reference original */
  raw: string;
  /** Se é formato Alusa v2 (prefixo alusa:) */
  isV2: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const EXTERNAL_REF_PREFIX = 'alusa:' as const;

export const ExternalReferencePrefix = {
  // V2 (novo padrão)
  CHARGE: 'alusa:charge:',
  SUBSCRIPTION: 'alusa:subscription:',
  INSTALLMENT: 'alusa:installment:',
  STANDALONE: 'alusa:standalone:',
  
  // V1 (legado - compat)
  LEGACY_SUBSCRIPTION: 'subscription:',
  LEGACY_INSTALLMENT_PLAN: 'installmentPlan:',
  LEGACY_STANDALONE_CHARGE: 'standaloneCharge:',
  LEGACY_CHARGE: 'charge:',
  LEGACY_STANDALONE: 'standalone:',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// BUILDERS - Geram externalReference canônico
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gera externalReference para cobrança acadêmica (com matrícula)
 * Formato: alusa:charge:{matriculaId}:{planoId}:{periodo}
 * (subcontaId removido — determinado pelo contexto da API key)
 */
export function buildChargeExternalReference(params: {
  matriculaId: string;
  planoId: string;
  periodo: string; // formato YYYY-MM ou YYYY-MM-DD
  subcontaId?: string; // deprecated — não incluído no output
}): string {
  const { matriculaId, planoId, periodo } = params;
  return `${ExternalReferencePrefix.CHARGE}${matriculaId}:${planoId}:${periodo}`;
}

/**
 * Gera externalReference para assinatura recorrente
 * Formato: alusa:subscription:{matriculaId}:{planoId}
 * (subcontaId removido — determinado pelo contexto da API key)
 */
export function buildSubscriptionExternalReference(params: {
  matriculaId: string;
  planoId: string;
  subcontaId?: string; // deprecated — não incluído no output
}): string {
  const { matriculaId, planoId } = params;
  return `${ExternalReferencePrefix.SUBSCRIPTION}${matriculaId}:${planoId}`;
}

/**
 * Gera externalReference para parcelamento
 * Formato: alusa:installment:{installmentPlanId}
 * (subcontaId removido — determinado pelo contexto da API key)
 */
export function buildInstallmentExternalReference(params: {
  installmentPlanId: string;
  subcontaId?: string; // deprecated — não incluído no output
}): string {
  const { installmentPlanId } = params;
  return `${ExternalReferencePrefix.INSTALLMENT}${installmentPlanId}`;
}

/**
 * Gera externalReference para cobrança standalone (customer-first)
 * Formato: alusa:standalone:{chargeId}
 * (subcontaId removido — determinado pelo contexto da API key)
 */
export function buildStandaloneExternalReference(params: {
  chargeId: string;
  subcontaId?: string; // deprecated — não incluído no output
}): string {
  const { chargeId } = params;
  return `${ExternalReferencePrefix.STANDALONE}${chargeId}`;
}

/**
 * Gera externalReference para um payment específico de assinatura/parcelamento
 * Formato: {parentExternalRef}:payment:{asaasPaymentId}
 */
export function buildPaymentExternalReference(
  parentExternalRef: string,
  asaasPaymentId: string
): string {
  return `${parentExternalRef}:payment:${asaasPaymentId}`;
}

/**
 * Prefixo canônico para payments de um parent externalReference.
 * Ex.: alusa:installment:ip_1 -> alusa:installment:ip_1:payment:
 */
export function buildPaymentReferencePrefix(parentExternalRef: string): string {
  return `${parentExternalRef}:payment:`;
}

/**
 * Verifica se um payment externalReference pertence exatamente ao parent informado.
 * Evita falso-positivo de prefixo (ex.: plano A não casa com plano AB).
 */
export function isPaymentReferenceForParent(
  paymentExternalReference: string | null | undefined,
  parentExternalReference: string | null | undefined,
): boolean {
  if (!paymentExternalReference || !parentExternalReference) return false;
  if (paymentExternalReference === parentExternalReference) return true;
  return paymentExternalReference.startsWith(buildPaymentReferencePrefix(parentExternalReference));
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSERS - Extraem informações do externalReference
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Faz parse de um externalReference e extrai tipo e IDs
 */
export function parseExternalReference(ref: string | undefined | null): ParsedExternalReference | null {
  if (!ref || typeof ref !== 'string') {
    return null;
  }

  const raw = ref.trim();
  if (!raw) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // V2: Formato Alusa (alusa:type:...)
  // ─────────────────────────────────────────────────────────────────────────

  // alusa:charge:{matriculaId}:{planoId}:{periodo} (V2 novo) ou
  // alusa:charge:{matriculaId}:{planoId}:{periodo}:{subcontaId} (V2 legado)
  if (raw.startsWith(ExternalReferencePrefix.CHARGE)) {
    const parts = raw.slice(ExternalReferencePrefix.CHARGE.length).split(':');
    if (parts.length >= 3) {
      // Verificar se há payment suffix
      const paymentIdx = parts.indexOf('payment');
      if (paymentIdx !== -1 && parts[paymentIdx + 1]) {
        return {
          type: 'payment',
          ids: {
            matriculaId: parts[0],
            planoId: parts[1],
            periodo: parts[2],
            subcontaId: parts[3] !== 'payment' ? parts[3] : undefined,
            asaasPaymentId: parts[paymentIdx + 1],
          },
          raw,
          isV2: true,
        };
      }
      return {
        type: 'charge',
        ids: {
          matriculaId: parts[0],
          planoId: parts[1],
          periodo: parts[2],
          subcontaId: parts[3],
        },
        raw,
        isV2: true,
      };
    }
  }

  // alusa:subscription:{matriculaId}:{planoId} (V2 novo) ou
  // alusa:subscription:{matriculaId}:{planoId}:{subcontaId} (V2 legado)
  if (raw.startsWith(ExternalReferencePrefix.SUBSCRIPTION)) {
    const parts = raw.slice(ExternalReferencePrefix.SUBSCRIPTION.length).split(':');
    if (parts.length >= 2) {
      const paymentIdx = parts.indexOf('payment');
      if (paymentIdx !== -1 && parts[paymentIdx + 1]) {
        return {
          type: 'payment',
          ids: {
            matriculaId: parts[0],
            planoId: parts[1],
            subcontaId: parts[2] !== 'payment' ? parts[2] : undefined,
            asaasPaymentId: parts[paymentIdx + 1],
          },
          raw,
          isV2: true,
        };
      }
      return {
        type: 'subscription',
        ids: {
          matriculaId: parts[0],
          planoId: parts[1],
          subcontaId: parts[2],
        },
        raw,
        isV2: true,
      };
    }
  }

  // alusa:installment:{installmentPlanId} (V2 novo) ou
  // alusa:installment:{installmentPlanId}:{subcontaId} (V2 legado)
  if (raw.startsWith(ExternalReferencePrefix.INSTALLMENT)) {
    const parts = raw.slice(ExternalReferencePrefix.INSTALLMENT.length).split(':');
    if (parts.length >= 1) {
      const paymentIdx = parts.indexOf('payment');
      if (paymentIdx !== -1 && parts[paymentIdx + 1]) {
        return {
          type: 'payment',
          ids: {
            installmentPlanId: parts[0],
            subcontaId: parts[1] !== 'payment' ? parts[1] : undefined,
            asaasPaymentId: parts[paymentIdx + 1],
          },
          raw,
          isV2: true,
        };
      }
      return {
        type: 'installment',
        ids: {
          installmentPlanId: parts[0],
          subcontaId: parts[1],
        },
        raw,
        isV2: true,
      };
    }
  }

  // alusa:standalone:{chargeId} (V2 novo) ou
  // alusa:standalone:{chargeId}:{subcontaId} (V2 legado)
  if (raw.startsWith(ExternalReferencePrefix.STANDALONE)) {
    const parts = raw.slice(ExternalReferencePrefix.STANDALONE.length).split(':');
    if (parts.length >= 1) {
      return {
        type: 'standalone',
        ids: {
          chargeId: parts[0],
          subcontaId: parts[1],
        },
        raw,
        isV2: true,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // V1: Formato legado (compat)
  // ─────────────────────────────────────────────────────────────────────────

  // subscription:{subscriptionId}
  if (raw.startsWith(ExternalReferencePrefix.LEGACY_SUBSCRIPTION)) {
    const rest = raw.slice(ExternalReferencePrefix.LEGACY_SUBSCRIPTION.length);
    const parts = rest.split(':');
    const paymentIdx = parts.indexOf('payment');
    if (paymentIdx !== -1 && parts[paymentIdx + 1]) {
      return {
        type: 'payment',
        ids: {
          subscriptionId: parts[0],
          asaasPaymentId: parts[paymentIdx + 1],
        },
        raw,
        isV2: false,
      };
    }
    return {
      type: 'subscription',
      ids: { subscriptionId: parts[0] },
      raw,
      isV2: false,
    };
  }

  // installmentPlan:{installmentPlanId}
  if (raw.startsWith(ExternalReferencePrefix.LEGACY_INSTALLMENT_PLAN)) {
    const rest = raw.slice(ExternalReferencePrefix.LEGACY_INSTALLMENT_PLAN.length);
    const parts = rest.split(':');
    const paymentIdx = parts.indexOf('payment');
    if (paymentIdx !== -1 && parts[paymentIdx + 1]) {
      return {
        type: 'payment',
        ids: {
          installmentPlanId: parts[0],
          asaasPaymentId: parts[paymentIdx + 1],
        },
        raw,
        isV2: false,
      };
    }
    return {
      type: 'installment',
      ids: { installmentPlanId: parts[0] },
      raw,
      isV2: false,
    };
  }

  // standaloneCharge:{chargeId}
  if (raw.startsWith(ExternalReferencePrefix.LEGACY_STANDALONE_CHARGE)) {
    const id = raw.slice(ExternalReferencePrefix.LEGACY_STANDALONE_CHARGE.length);
    return {
      type: 'standalone',
      ids: { chargeId: id },
      raw,
      isV2: false,
    };
  }

  // charge:{cobrancaId}
  if (raw.startsWith(ExternalReferencePrefix.LEGACY_CHARGE)) {
    const id = raw.slice(ExternalReferencePrefix.LEGACY_CHARGE.length);
    return {
      type: 'charge',
      ids: { chargeId: id },
      raw,
      isV2: false,
    };
  }

  // standalone:{idempotencyKey}
  if (raw.startsWith(ExternalReferencePrefix.LEGACY_STANDALONE)) {
    const id = raw.slice(ExternalReferencePrefix.LEGACY_STANDALONE.length);
    return {
      type: 'standalone',
      ids: { chargeId: id },
      raw,
      isV2: false,
    };
  }

  // Formato desconhecido
  return {
    type: 'unknown',
    ids: {},
    raw,
    isV2: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS - Verificações de tipo
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se uma externalReference pertence a um tipo específico
 */
export function isExternalReferenceOfType(
  ref: string | undefined | null,
  type: ExternalReferenceType
): boolean {
  const parsed = parseExternalReference(ref);
  return parsed?.type === type;
}

/**
 * Extrai o ID principal de uma externalReference
 */
export function extractPrimaryId(ref: string | undefined | null): string | null {
  const parsed = parseExternalReference(ref);
  if (!parsed) return null;

  switch (parsed.type) {
    case 'charge':
      return parsed.ids.matriculaId ?? parsed.ids.chargeId ?? null;
    case 'subscription':
      return parsed.ids.subscriptionId ?? parsed.ids.matriculaId ?? null;
    case 'installment':
      return parsed.ids.installmentPlanId ?? null;
    case 'standalone':
      return parsed.ids.chargeId ?? null;
    case 'payment':
      return parsed.ids.asaasPaymentId ?? null;
    default:
      return null;
  }
}

/**
 * Verifica se o externalReference é do formato V2 (novo padrão)
 */
export function isV2ExternalReference(ref: string | undefined | null): boolean {
  const parsed = parseExternalReference(ref);
  return parsed?.isV2 ?? false;
}
