declare module '@alusa/finance' {
  export function ensureAsaasCustomerForPayer(
    params: import('../alunos/asaas-finance-bridge').EnsureAsaasCustomerForPayerParams,
  ): Promise<import('../alunos/asaas-finance-bridge').EnsureAsaasCustomerResult>;

  export function loadAndValidateSubaccountKey(
    contaId: string,
  ): Promise<import('../alunos/asaas-finance-bridge').LoadKeyResult>;

  export function syncAlunoInativacaoToAsaas(params: {
    alunoId: string;
    contaId: string;
  }): Promise<import('../alunos/asaas-finance-bridge').AlunoAsaasLifecycleResult>;

  export function syncAlunoToAsaasProvider(params: {
    alunoId: string;
    contaId: string;
  }): Promise<void>;
}
