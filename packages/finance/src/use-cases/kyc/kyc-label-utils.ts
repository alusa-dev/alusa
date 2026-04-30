/**
 * Utilitário unificado para derivar labels de documentos/slots.
 *
 * Elimina duplicação de lógica de "Frente"/"Verso" que existia em 3 locais:
 * - get-kyc-snapshot.ts (deriveSlots)
 * - kyc-persistence.service.ts (deriveSlotLabel)
 * - KycUploadModal.tsx (slotLabels)
 */

const DOCUMENT_LABEL_MAP: Record<string, string> = {
  IDENTIFICATION: 'Documento com foto',
  IDENTIFICATION_SELFIE: 'Selfie de verificação',
  MEI_CERTIFICATE: 'Certificado MEI',
  SOCIAL_CONTRACT: 'Contrato social',
  ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT: 'Comprovante bancário',
};

/**
 * Retorna label humanizado para um tipo de grupo de documentos.
 * Usa título do Asaas quando disponível, com fallback para mapa interno.
 */
export function deriveGroupLabel(asaasTitle: string | null | undefined, groupType: string | null | undefined): string {
  if (asaasTitle?.trim()) return asaasTitle.trim();
  const key = (groupType ?? '').trim().toUpperCase();
  return DOCUMENT_LABEL_MAP[key] ?? 'Documento solicitado';
}

/**
 * Retorna label humanizado para um slot individual dentro de um grupo.
 */
export function deriveSlotLabel(index: number, total: number): string {
  if (total === 1) return 'Documento';
  if (total === 2) return index === 0 ? 'Frente' : 'Verso';
  return `Arquivo ${index + 1}`;
}
