import { prisma } from '@alusa/database';
import { deleteCustomer } from '@alusa/asaas';
import { calcIdade } from '@alusa/lib';
import {
  inactivateCustomerIfSafe,
} from '../customer/asaas-customer.service';
import {
  ensureAsaasCustomerForPayer,
  loadAndValidateSubaccountKey,
  type EnsureAsaasCustomerPayer,
} from './ensure-asaas-customer-for-payer';

export type AlunoAsaasLifecycleResult = {
  success: boolean;
  action: 'INACTIVATED' | 'SKIPPED' | 'ERROR';
  reason?: string;
  error?: string;
};

export async function syncAlunoInativacaoToAsaas(params: {
  alunoId: string;
  contaId: string;
}): Promise<AlunoAsaasLifecycleResult> {
  const { alunoId, contaId } = params;

  try {
    const aluno = await prisma.aluno.findUnique({
      where: { id: alunoId },
      include: {
        responsaveis: {
          include: { responsavel: true },
          take: 1,
        },
      },
    });

    if (!aluno) {
      return { success: false, action: 'ERROR', error: 'ALUNO_NOT_FOUND' };
    }

    const idade = calcIdade(aluno.dataNasc);
    const isMenor = idade < 18;
    const responsavel = aluno.responsaveis[0]?.responsavel ?? null;

    if (!isMenor && !aluno.asaasCustomerId) {
      const payerForEnsure: EnsureAsaasCustomerPayer = {
        type: 'ALUNO',
        id: aluno.id,
        name: aluno.nome,
        cpfCnpj: aluno.cpf ?? '',
        email: aluno.email ?? undefined,
        phone: aluno.telefone ?? undefined,
        mobilePhone: aluno.telefone ?? undefined,
        address: aluno.enderecoLogradouro ?? undefined,
        postalCode: aluno.enderecoCep ?? undefined,
        addressNumber: aluno.enderecoNumero ?? undefined,
        complement: aluno.enderecoComplemento ?? undefined,
        province: aluno.enderecoBairro ?? undefined,
      };

      if (!payerForEnsure.cpfCnpj) {
        return { success: true, action: 'SKIPPED', reason: 'MISSING_CPF_CNPJ' };
      }

      const ensureResult = await ensureAsaasCustomerForPayer({
        contaId,
        payer: payerForEnsure,
      });

      if (!ensureResult.ok) {
        return { success: false, action: 'ERROR', error: 'ENSURE_CUSTOMER_FAILED' };
      }

      return { success: true, action: 'SKIPPED', reason: 'ADULT_CUSTOMER_CREATED' };
    }

    const customerId = isMenor ? responsavel?.asaasCustomerId : aluno.asaasCustomerId;
    if (!customerId) {
      return { success: true, action: 'SKIPPED', reason: 'NO_CUSTOMER_ID' };
    }

    const keyResult = await loadAndValidateSubaccountKey(contaId);
    if (!keyResult.ok) {
      return { success: false, action: 'ERROR', error: 'INVALID_API_KEY' };
    }

    const inactivation = await inactivateCustomerIfSafe({
      asaasCustomerId: customerId,
      contaId,
      alunoId,
      deleteCustomerFn: async (asaasCustomerId) => {
        await deleteCustomer({
          apiKey: keyResult.apiKey,
          customerId: asaasCustomerId,
        });
      },
    });

    if (inactivation.action === 'INACTIVATED') {
      return { success: true, action: 'INACTIVATED' };
    }

    if (inactivation.action === 'SKIPPED') {
      return { success: true, action: 'SKIPPED', reason: inactivation.reason };
    }

    return {
      success: false,
      action: 'ERROR',
      error: inactivation.error ?? inactivation.reason,
    };
  } catch (error) {
    return {
      success: false,
      action: 'ERROR',
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    };
  }
}

export async function syncAlunoToAsaasProvider(params: {
  alunoId: string;
  contaId: string;
}): Promise<void> {
  const { alunoId, contaId } = params;

  try {
    const aluno = await prisma.aluno.findUnique({
      where: { id: alunoId },
      include: {
        responsaveis: {
          include: { responsavel: true },
          take: 1,
        },
      },
    });

    if (!aluno) return;

    const idade = calcIdade(aluno.dataNasc);
    const isMenor = idade < 18;
    const responsavel = aluno.responsaveis[0]?.responsavel ?? null;
    const payerForEnsure: EnsureAsaasCustomerPayer | null = isMenor
      ? responsavel
        ? {
            type: 'RESPONSAVEL',
            id: responsavel.id,
            name: responsavel.nome,
            cpfCnpj: responsavel.cpf,
            email: responsavel.email,
            phone: responsavel.telefone,
            mobilePhone: responsavel.telefone,
            address: responsavel.enderecoLogradouro ?? undefined,
            postalCode: responsavel.enderecoCep ?? undefined,
            addressNumber: responsavel.enderecoNumero ?? undefined,
            complement: responsavel.enderecoComplemento ?? undefined,
            province: responsavel.enderecoBairro ?? undefined,
          }
        : null
      : {
          type: 'ALUNO',
          id: aluno.id,
          name: aluno.nome,
          cpfCnpj: aluno.cpf ?? '',
          email: aluno.email ?? undefined,
          phone: aluno.telefone ?? undefined,
          mobilePhone: aluno.telefone ?? undefined,
          address: aluno.enderecoLogradouro ?? undefined,
          postalCode: aluno.enderecoCep ?? undefined,
          addressNumber: aluno.enderecoNumero ?? undefined,
          complement: aluno.enderecoComplemento ?? undefined,
          province: aluno.enderecoBairro ?? undefined,
        };

    if (!payerForEnsure?.cpfCnpj) return;

    await ensureAsaasCustomerForPayer({
      contaId,
      payer: payerForEnsure,
    });
  } catch (error) {
    console.error('[syncAlunoToAsaasProvider] Falha não-bloqueante:', error);
  }
}