export class ProviderPortalRequiredError extends Error {
  readonly code = 'PROVIDER_PORTAL_REQUIRED' as const;
  readonly groupId: string;

  constructor(params: { groupId: string; message?: string }) {
    super(
      params.message ??
        'Esta etapa precisa ser concluída no ambiente de verificação configurado para a conta.',
    );
    this.name = 'ProviderPortalRequiredError';
    this.groupId = params.groupId;
  }
}
