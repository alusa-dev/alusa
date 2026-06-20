import { prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import {
  evaluatePayerAddressFiscalReadiness,
  payerAddressFromRecord,
  type PayerAddressIssue,
} from '@alusa/lib';

export type PayerFiscalReadinessResult = {
  ready: boolean;
  issues: PayerAddressIssue[];
  responsavelId?: string;
  responsavelNome?: string;
};

export type PayerFiscalReadinessApiIssue = {
  code: string;
  message: string;
  blocking: boolean;
};

export function mapPayerFiscalReadinessForApi(result: PayerFiscalReadinessResult): {
  ready: boolean;
  issues: PayerFiscalReadinessApiIssue[];
  responsavelId?: string;
  responsavelNome?: string;
} {
  return {
    ready: result.ready,
    issues: result.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      blocking: true,
    })),
    responsavelId: result.responsavelId,
    responsavelNome: result.responsavelNome,
  };
}

export async function evaluateResponsavelPayerFiscalReadiness(input: {
  contaId: string;
  responsavelId: string;
}): Promise<PayerFiscalReadinessResult> {
  const responsavel = await prisma.responsavel.findFirst({
    where: { id: input.responsavelId, contaId: input.contaId },
    select: {
      id: true,
      nome: true,
      financeiro: true,
      enderecoCep: true,
      enderecoLogradouro: true,
      enderecoNumero: true,
      enderecoComplemento: true,
      enderecoBairro: true,
      enderecoCidade: true,
      enderecoUf: true,
    },
  });

  if (!responsavel) {
    return {
      ready: false,
      issues: [{ code: 'PAYER_NOT_FOUND', message: 'Responsável financeiro não encontrado.' }],
    };
  }

  const readiness = evaluatePayerAddressFiscalReadiness(payerAddressFromRecord(responsavel));

  return {
    ready: readiness.ready,
    issues: readiness.issues,
    responsavelId: responsavel.id,
    responsavelNome: responsavel.nome,
  };
}

export async function evaluateChargePayerFiscalReadiness(input: {
  contaId: string;
  chargeId: string;
}): Promise<PayerFiscalReadinessResult> {
  const charge = await prisma.charge.findFirst({
    where: { id: input.chargeId, contaId: input.contaId },
    select: {
      customer: {
        select: {
          payerType: true,
          payerId: true,
        },
      },
      cobranca: {
        select: {
          matricula: {
            select: {
              responsavelFinanceiroId: true,
            },
          },
        },
      },
    },
  });

  if (!charge) {
    return {
      ready: false,
      issues: [{ code: 'CHARGE_NOT_FOUND', message: 'Cobrança não encontrada.' }],
    };
  }

  const responsavelId =
    charge.customer?.payerType === 'RESPONSAVEL'
      ? charge.customer.payerId
      : charge.cobranca?.matricula?.responsavelFinanceiroId ?? null;

  if (!responsavelId) {
    return {
      ready: true,
      issues: [],
    };
  }

  return evaluateResponsavelPayerFiscalReadiness({
    contaId: input.contaId,
    responsavelId,
  });
}

export function isAsaasCustomerAddressError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /endere[cç]o.*cliente|cep.*cliente|postal|address/i.test(message);
}

export type SyncResponsavelAsaasCustomerResult =
  | { ok: true; customerId: string; reused: boolean; warnings?: string[] }
  | { ok: false; code: string; message: string; issues?: PayerAddressIssue[] };

export async function syncResponsavelAsaasCustomer(input: {
  contaId: string;
  responsavelId: string;
  requireFiscalAddress?: boolean;
  notificationSyncMode?: 'blocking' | 'deferred' | 'skip';
}): Promise<SyncResponsavelAsaasCustomerResult> {
  const { ensureAsaasCustomerForPayer } = await import('../use-cases/ensure-asaas-customer-for-payer');

  const responsavel = await prisma.responsavel.findFirst({
    where: { id: input.responsavelId, contaId: input.contaId },
    select: {
      id: true,
      nome: true,
      cpf: true,
      email: true,
      telefone: true,
      financeiro: true,
      asaasCustomerId: true,
      enderecoCep: true,
      enderecoLogradouro: true,
      enderecoNumero: true,
      enderecoComplemento: true,
      enderecoBairro: true,
      enderecoCidade: true,
      enderecoUf: true,
    },
  });

  if (!responsavel) {
    return { ok: false, code: 'PAYER_NOT_FOUND', message: 'Responsável não encontrado.' };
  }

  const addressReadiness = evaluatePayerAddressFiscalReadiness(payerAddressFromRecord(responsavel));
  if (input.requireFiscalAddress !== false && responsavel.financeiro && !addressReadiness.ready) {
    return {
      ok: false,
      code: 'PAYER_ADDRESS_INCOMPLETE',
      message: addressReadiness.issues[0]?.message ?? 'Endereço do responsável incompleto.',
      issues: addressReadiness.issues,
    };
  }

  const ensureResult = await ensureAsaasCustomerForPayer({
    contaId: input.contaId,
    payer: {
      type: 'RESPONSAVEL',
      id: responsavel.id,
      name: responsavel.nome,
      cpfCnpj: responsavel.cpf,
      email: responsavel.email,
      phone: responsavel.telefone,
      mobilePhone: responsavel.telefone,
      address: responsavel.enderecoLogradouro,
      postalCode: responsavel.enderecoCep,
      addressNumber: responsavel.enderecoNumero,
      complement: responsavel.enderecoComplemento,
      province: responsavel.enderecoBairro,
      asaasCustomerId: responsavel.asaasCustomerId,
    },
    notificationSyncMode: input.notificationSyncMode ?? 'deferred',
    strictCustomerUpdate: input.requireFiscalAddress !== false,
  });

  if (!ensureResult.ok) {
    return {
      ok: false,
      code: ensureResult.error,
      message: ensureResult.message,
    };
  }

  const warnings: string[] = [];
  if (responsavel.financeiro && !addressReadiness.ready) {
    warnings.push('Customer sincronizado sem endereço completo — NFS-e pode falhar.');
  }

  return {
    ok: true,
    customerId: ensureResult.customerId,
    reused: ensureResult.reused,
    warnings: warnings.length ? warnings : undefined,
  };
}

export async function syncResponsavelAsaasCustomerResult(
  input: Parameters<typeof syncResponsavelAsaasCustomer>[0],
): Promise<Result<{ customerId: string; reused: boolean }, string>> {
  const result = await syncResponsavelAsaasCustomer(input);
  if (!result.ok) return err(result.message);
  return ok({ customerId: result.customerId, reused: result.reused });
}
