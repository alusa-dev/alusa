export class AsaasSandboxSubaccountDailyLimitError extends Error {
  readonly code = 'ASAAS_SANDBOX_SUBACCOUNT_DAILY_LIMIT' as const;

  constructor() {
    super('Limite diário de criação de subcontas no Sandbox do Asaas atingido.');
    this.name = 'AsaasSandboxSubaccountDailyLimitError';
  }
}
