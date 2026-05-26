import type { EnsureAsaasCustomerError } from '../errors/asaas-customer-ensure-error';

export type EnsureAsaasCustomerPayer = {
  type: 'ALUNO' | 'RESPONSAVEL';
  id?: string;
  name: string;
  cpfCnpj: string;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  address?: string | null;
  postalCode?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  province?: string | null;
  asaasCustomerId?: string | null;
};

export type EnsureAsaasCustomerResult =
  | {
      ok: true;
      customerId: string;
      externalReference: string;
      reused: boolean;
    }
  | {
      ok: false;
      error: EnsureAsaasCustomerError;
      message: string;
      status?: number;
    };

export type LoadKeyResult =
  | {
      ok: true;
      apiKey: string;
      source: 'ASAAS_ACCOUNT' | 'ASAAS_CREDENTIAL';
      asaasAccountId?: string | null;
    }
  | {
      ok: false;
      code: EnsureAsaasCustomerError;
      message: string;
      asaasAccountId?: string | null;
    };

export type EnsureAsaasCustomerForPayerParams = {
  contaId: string;
  payer: EnsureAsaasCustomerPayer;
  persist?: boolean;
  notificationSyncMode?: 'blocking' | 'deferred' | 'skip';
};

export type AlunoAsaasLifecycleResult = {
  success: boolean;
  action: 'INACTIVATED' | 'SKIPPED' | 'ERROR';
  reason?: string;
  error?: string;
};

type FinanceAlunoModule = typeof import('@alusa/finance');

let financeModulePromise: Promise<FinanceAlunoModule> | null = null;

function loadFinanceModule(): Promise<FinanceAlunoModule> {
  if (!financeModulePromise) {
    financeModulePromise = import('@alusa/finance');
  }
  return financeModulePromise;
}

export async function ensureAsaasCustomerForPayer(
  params: EnsureAsaasCustomerForPayerParams,
): Promise<EnsureAsaasCustomerResult> {
  const finance = await loadFinanceModule();
  return finance.ensureAsaasCustomerForPayer(params);
}

export async function loadAndValidateSubaccountKey(contaId: string): Promise<LoadKeyResult> {
  const finance = await loadFinanceModule();
  return finance.loadAndValidateSubaccountKey(contaId);
}

export async function syncAlunoInativacaoToAsaas(params: {
  alunoId: string;
  contaId: string;
}): Promise<AlunoAsaasLifecycleResult> {
  const finance = await loadFinanceModule();
  return finance.syncAlunoInativacaoToAsaas(params);
}

export async function syncAlunoToAsaasProvider(params: { alunoId: string; contaId: string }) {
  const finance = await loadFinanceModule();
  return finance.syncAlunoToAsaasProvider(params);
}
