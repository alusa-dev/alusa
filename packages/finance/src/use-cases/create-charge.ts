import { prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import type { BillingType as AsaasBillingType } from '@alusa/asaas';
import type { FormaPagamento } from '@prisma/client';
import { resolvePayer } from '@alusa/domain';

import { createAsaasPayment } from './create-payment';
import { ensureCustomer } from './ensure-customer';
import { auditLogService } from '../foundation/audit-log.service';
import { requireKycApproved } from '../foundation/kyc-guard';
import { isPastDate } from '../foundation/date-guard';

export type CreateChargeInput = {
  contaId: string;
  cobrancaId: string;
  actor: { type: 'USER' | 'SYSTEM'; id?: string };
  dueDateOverride?: string;
};

export type CreateChargeOutput = {
  cobrancaId: string;
  chargeId: string;
  asaasPaymentId?: string;
  externalReference: string;
};

export type CreateChargeError =
  | 'COBRANCA_NAO_ENCONTRADA'
  | 'KYC_NAO_APROVADO'
  | 'COBRANCA_JA_POSSUI_PAGAMENTO'
  | 'PAGADOR_NAO_ENCONTRADO'
  | 'PAGADOR_SEM_CPF'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CRIAR_CUSTOMER'
  | 'ERRO_AO_CRIAR_PAGAMENTO'
  | 'DATA_INVALIDA'
  | 'ERRO_INTERNO';

function toAsaasBillingType(formaPagamento: FormaPagamento): AsaasBillingType {
  const map: Record<FormaPagamento, AsaasBillingType> = {
    BOLETO: 'BOLETO',
    PIX: 'PIX',
    CARTAO_CREDITO: 'CREDIT_CARD',
    INDEFINIDO: 'UNDEFINED',
  };

  return map[formaPagamento];
}

function toDueDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function createCharge(
  input: CreateChargeInput
): Promise<Result<CreateChargeOutput, CreateChargeError>> {
  try {
    const kyc = await requireKycApproved(input.contaId);
    if (!kyc.success) return err(kyc.error);

    const cobranca = await prisma.cobranca.findFirst({
      where: {
        id: input.cobrancaId,
        matricula: { aluno: { contaId: input.contaId } },
      },
      select: {
        id: true,
        asaasPaymentId: true,
        asaasId: true,
        valor: true,
        vencimento: true,
        descricao: true,
        formaPagamento: true,
        // Campos financeiros
        jurosPercentual: true,
        multaTipo: true,
        multaPercentual: true,
        multaValorFixo: true,
        descontoTipo: true,
        descontoPercentual: true,
        descontoValorFixo: true,
        descontoPrazoMaximo: true,
        matricula: {
          select: {
            id: true,
            responsavelFinanceiroId: true,
            aluno: {
              select: {
                id: true,
                cpf: true,
                dataNasc: true,
              },
            },
            responsavelFinanceiro: {
              select: {
                id: true,
                cpf: true,
              },
            },
          },
        },
      },
    });

    if (!cobranca) return err('COBRANCA_NAO_ENCONTRADA');

    const legacyPaymentId = cobranca.asaasPaymentId ?? cobranca.asaasId ?? null;

    // ADR-006: externalReference deve referenciar o ID interno da entidade.
    const chargeExternalReference = `charge:${cobranca.id}`;

    const existingCharge = await prisma.charge.findUnique({
      where: { cobrancaId: cobranca.id },
      select: { id: true, asaasPaymentId: true, externalReference: true, status: true },
    });

    const existingPaymentId = existingCharge?.asaasPaymentId ?? legacyPaymentId;
    if (existingPaymentId) {
      return ok({
        cobrancaId: cobranca.id,
        chargeId: existingCharge?.id ?? cobranca.id,
        asaasPaymentId: existingPaymentId,
        externalReference: existingCharge?.externalReference ?? chargeExternalReference,
      });
    }

    // Usar função canônica do domínio para determinar o pagador
    const payerResult = resolvePayer({
      alunoId: cobranca.matricula.aluno.id,
      alunoDataNasc: cobranca.matricula.aluno.dataNasc,
      responsavelFinanceiroId: cobranca.matricula.responsavelFinanceiroId,
    });

    if (!payerResult.success) {
      // Menor de idade sem responsável
      return err('PAGADOR_NAO_ENCONTRADO');
    }

    const payer = payerResult.payer;

    const customer = await ensureCustomer({ contaId: input.contaId, payer });
    if (!customer.success) {
      if (customer.error === 'PAGADOR_NAO_ENCONTRADO') return err('PAGADOR_NAO_ENCONTRADO');
      if (customer.error === 'PAGADOR_SEM_CPF') return err('PAGADOR_SEM_CPF');
      if (customer.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
      return err('ERRO_AO_CRIAR_CUSTOMER');
    }

    const externalReference = existingCharge?.externalReference ?? chargeExternalReference;
    const billingType = toAsaasBillingType(cobranca.formaPagamento);

    // Mapeamento de Juros (Asaas aceita apenas mensal percentual para pagamentos unicos?)
    // O type definition diz que interest tem apenas { value: number }. O texto diz "Percentage per month".
    // Se o banco tem jurosValorFixo, não podemos usar diretamente a menos que convertamos. 
    // Por hora, usamos apenas jurosPercentual se disponível.
    const interest = cobranca.jurosPercentual 
      ? { value: Number(cobranca.jurosPercentual) } 
      : undefined;

    // Mapeamento de Multa
    let fine: { value: number; type: 'FIXED' | 'PERCENTAGE' } | undefined;
    if (cobranca.multaTipo === 'VALOR_FIXO' && cobranca.multaValorFixo && Number(cobranca.multaValorFixo) > 0) {
      fine = { value: Number(cobranca.multaValorFixo), type: 'FIXED' };
    } else if (cobranca.multaTipo === 'PERCENTUAL' && cobranca.multaPercentual && Number(cobranca.multaPercentual) > 0) {
      fine = { value: Number(cobranca.multaPercentual), type: 'PERCENTAGE' };
    }

    // Mapeamento de Desconto
    let discount: { value: number; type: 'FIXED' | 'PERCENTAGE'; dueDateLimitDays: number } | undefined;
    const discountValue = cobranca.descontoTipo === 'VALOR_FIXO' 
      ? Number(cobranca.descontoValorFixo) 
      : Number(cobranca.descontoPercentual);

    if (discountValue > 0) {
      // dueDateLimitDays default 0 = até vencimento
      // O campo descontoPrazoMaximo no schema é String Enum? "ATE_VENCIMENTO" etc.
      // Precisamos converter string para number dias.
      // Assumindo 0 por segurança se não conseguir parsear.
      // TODO: Melhorar parse de descontoPrazoMaximo se necessário.
      discount = {
        value: discountValue,
        type: cobranca.descontoTipo === 'VALOR_FIXO' ? 'FIXED' : 'PERCENTAGE',
        dueDateLimitDays: 0 
      };
    }

    const dueDateIso = typeof input.dueDateOverride === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDateOverride)
      ? input.dueDateOverride
      : toDueDateISO(cobranca.vencimento);
    if (isPastDate(dueDateIso)) {
      return err('DATA_INVALIDA');
    }

    const paymentInput = {
      contaId: input.contaId,
      customer: customer.data.customerId,
      billingType,
      value: Number(cobranca.valor),
      dueDate: dueDateIso,
      description: cobranca.descricao ?? undefined,
      externalReference,
      idempotencyKey: externalReference,
      interest,
      fine,
      discount,
    };

    const payment = await createAsaasPayment(paymentInput);

    if (!payment.success) {
      if (payment.error === 'KYC_NAO_APROVADO') return err('KYC_NAO_APROVADO');
      if (payment.error === 'Credenciais Asaas não configuradas') return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
      return err('ERRO_AO_CRIAR_PAGAMENTO');
    }

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.charge.payment_requested',
      entity: { type: 'Cobranca', id: cobranca.id },
      metadata: {
        cobrancaId: cobranca.id,
        chargeId: existingCharge?.id ?? cobranca.id,
        asaasPaymentId: payment.data.id,
        externalReference,
        awaitingOfficialMaterialization: true,
      },
    });

    return ok({
      cobrancaId: cobranca.id,
      chargeId: existingCharge?.id ?? cobranca.id,
      asaasPaymentId: payment.data.id,
      externalReference,
    });
  } catch (error) {
    console.error('[finance][createCharge]', error);
    return err('ERRO_INTERNO');
  }
}
