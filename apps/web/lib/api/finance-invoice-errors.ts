type InvoiceProviderError = {
  kind: string;
  status?: number;
};

export function publicInvoiceProviderErrorMessage(
  error: unknown,
  action: 'agendar' | 'emitir' | 'cancelar' | 'sincronizar',
) {
  if (
    error &&
    typeof error === 'object' &&
    'kind' in error &&
    (error as InvoiceProviderError).kind === 'ASAAS'
  ) {
    return `Não foi possível ${action} a nota fiscal no provedor financeiro.`;
  }

  return `Não foi possível ${action} a nota fiscal.`;
}
