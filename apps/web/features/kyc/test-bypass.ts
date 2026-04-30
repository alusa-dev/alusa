function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  return null;
}

/**
 * Kill switch temporário para testes manuais:
 * - em desenvolvimento fica ligado por padrão;
 * - pode ser controlado explicitamente via env.
 */
export function isPendingDocumentsBlockBypassedForTesting(): boolean {
  const override = parseBooleanEnv(process.env.NEXT_PUBLIC_BYPASS_PENDING_DOCUMENTS_BLOCK);
  if (override !== null) return override;

  return process.env.NODE_ENV === 'development';
}
