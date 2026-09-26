export const ASAAS_EMAIL_IN_USE_CODE = 'ASAAS_EMAIL_IN_USE' as const;
export const ASAAS_EMAIL_IN_USE_PREFIX = `ACTION_REQUIRED:${ASAAS_EMAIL_IN_USE_CODE}:`;
export const ASAAS_EMAIL_IN_USE_MESSAGE =
  'Este e-mail já está em uso no Asaas. Informe outro e-mail para a subconta ou fale com o suporte da Alusa.';

export type AsaasProvisioningErrorClassification = {
  code: typeof ASAAS_EMAIL_IN_USE_CODE;
  retryable: false;
  userMessage: typeof ASAAS_EMAIL_IN_USE_MESSAGE;
  storedMessage: string;
};

function normalizeForMatching(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, '')
    .toLowerCase();
}

function providerErrorItems(error: unknown): Array<{ code?: string; description?: string }> {
  if (!error || typeof error !== 'object') return [];

  const response = (error as { response?: unknown; responseBody?: unknown }).response ??
    (error as { responseBody?: unknown }).responseBody;
  if (!response || typeof response !== 'object') return [];

  const errors = (response as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];

  return errors.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const value = item as { code?: unknown; description?: unknown };
    return [{
      ...(typeof value.code === 'string' ? { code: value.code } : {}),
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
    }];
  });
}

/** Classifies deterministic Asaas account conflicts so the worker does not retry them. */
export function classifyAsaasProvisioningError(
  error: unknown,
): AsaasProvisioningErrorClassification | null {
  const status = error && typeof error === 'object'
    ? (error as { status?: unknown }).status
    : undefined;
  if (status !== 400) return null;

  const isEmailInUse = providerErrorItems(error).some(({ code, description }) => {
    const normalizedCode = normalizeForMatching(code ?? '');
    const normalizedDescription = normalizeForMatching(description ?? '');
    return normalizedDescription.includes('email') &&
      (normalizedDescription.includes('em uso') || normalizedDescription.includes('already in use')) &&
      (normalizedCode === 'invalid_object' || normalizedCode.includes('email'));
  });

  if (!isEmailInUse) return null;

  return {
    code: ASAAS_EMAIL_IN_USE_CODE,
    retryable: false,
    userMessage: ASAAS_EMAIL_IN_USE_MESSAGE,
    storedMessage: `${ASAAS_EMAIL_IN_USE_PREFIX}${ASAAS_EMAIL_IN_USE_MESSAGE}`,
  };
}

export function getAsaasProvisioningUserMessage(error: unknown): string | null {
  return classifyAsaasProvisioningError(error)?.userMessage ?? null;
}
