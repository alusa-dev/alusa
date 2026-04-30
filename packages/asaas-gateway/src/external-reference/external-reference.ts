/**
 * External Reference - Padrão canônico para identificação determinística
 * 
 * Formato: {prefix}:{id}
 * 
 * Prefixos:
 * - subscription:{subscriptionId}     - Assinatura recorrente
 * - installmentPlan:{installmentPlanId} - Parcelamento
 * - standaloneCharge:{chargeId}       - Cobrança avulsa (customer-first)
 * - charge:{cobrancaId}               - Cobrança acadêmica
 * - transfer:{transferId}             - Transferência
 */

export const ExternalReferencePrefix = {
  SUBSCRIPTION: 'subscription:',
  INSTALLMENT_PLAN: 'installmentPlan:',
  STANDALONE_CHARGE: 'standaloneCharge:',
  CHARGE: 'charge:',
  TRANSFER: 'transfer:',
  // Legado (para compat)
  STANDALONE: 'standalone:',
} as const;

export type ExternalReferenceType =
  | 'subscription'
  | 'installmentPlan'
  | 'standaloneCharge'
  | 'charge'
  | 'transfer'
  | 'standalone' // legado
  | 'unknown';

export type ParsedExternalReference = {
  type: ExternalReferenceType;
  id: string;
  raw: string;
};

/**
 * Faz parse de uma externalReference no formato canônico
 */
export function parseExternalReference(ref: string | undefined | null): ParsedExternalReference | null {
  if (!ref || typeof ref !== 'string') {
    return null;
  }

  const raw = ref.trim();

  // subscription:{id}
  if (raw.startsWith(ExternalReferencePrefix.SUBSCRIPTION)) {
    return {
      type: 'subscription',
      id: raw.slice(ExternalReferencePrefix.SUBSCRIPTION.length),
      raw,
    };
  }

  // installmentPlan:{id}
  if (raw.startsWith(ExternalReferencePrefix.INSTALLMENT_PLAN)) {
    return {
      type: 'installmentPlan',
      id: raw.slice(ExternalReferencePrefix.INSTALLMENT_PLAN.length),
      raw,
    };
  }

  // standaloneCharge:{id}
  if (raw.startsWith(ExternalReferencePrefix.STANDALONE_CHARGE)) {
    return {
      type: 'standaloneCharge',
      id: raw.slice(ExternalReferencePrefix.STANDALONE_CHARGE.length),
      raw,
    };
  }

  // charge:{id}
  if (raw.startsWith(ExternalReferencePrefix.CHARGE)) {
    return {
      type: 'charge',
      id: raw.slice(ExternalReferencePrefix.CHARGE.length),
      raw,
    };
  }

  // transfer:{id}
  if (raw.startsWith(ExternalReferencePrefix.TRANSFER)) {
    return {
      type: 'transfer',
      id: raw.slice(ExternalReferencePrefix.TRANSFER.length),
      raw,
    };
  }

  // standalone:{id} (legado)
  if (raw.startsWith(ExternalReferencePrefix.STANDALONE)) {
    return {
      type: 'standalone',
      id: raw.slice(ExternalReferencePrefix.STANDALONE.length),
      raw,
    };
  }

  // Formato desconhecido - retorna unknown com id completo
  return {
    type: 'unknown',
    id: raw,
    raw,
  };
}

/**
 * Constrói uma externalReference canônica
 */
export function buildExternalReference(
  type: Exclude<ExternalReferenceType, 'unknown' | 'standalone'>,
  id: string
): string {
  switch (type) {
    case 'subscription':
      return `${ExternalReferencePrefix.SUBSCRIPTION}${id}`;
    case 'installmentPlan':
      return `${ExternalReferencePrefix.INSTALLMENT_PLAN}${id}`;
    case 'standaloneCharge':
      return `${ExternalReferencePrefix.STANDALONE_CHARGE}${id}`;
    case 'charge':
      return `${ExternalReferencePrefix.CHARGE}${id}`;
    case 'transfer':
      return `${ExternalReferencePrefix.TRANSFER}${id}`;
    default:
      throw new Error(`Unknown external reference type: ${type}`);
  }
}

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
 * Extrai o ID de uma externalReference se for do tipo esperado
 */
export function extractIdFromExternalReference(
  ref: string | undefined | null,
  expectedType: ExternalReferenceType
): string | null {
  const parsed = parseExternalReference(ref);
  if (parsed?.type === expectedType) {
    return parsed.id;
  }
  return null;
}
