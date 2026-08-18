export function generateContratoConsentimentoCodigo(index: number) {
  return `CONSENT_${String(index + 1).padStart(2, '0')}`;
}
