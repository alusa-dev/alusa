import {
  createCharge,
  getAsaasPaymentDetails,
  KycNotApprovedError,
  mapAsaasPaymentStatusToCobranca,
  normalizeAsaasPaymentSnapshotStatus,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import { StatusCobranca } from '@prisma/client';
import { matriculaReenviarCobrancaResultDTOSchema } from '@/features/cadastro/matriculas/dtos';
import { mapMatriculaReenviarCobrancaResultToDTO } from '@/features/cadastro/matriculas/mappers';
import { matriculaRouteRepository } from './matricula-route.repository';
import { materializeSubscriptionPaymentForCharge } from './subscription-payment-materialization';

type ResendSuccess = {
  kind: 'SUCCESS';
  data: ReturnType<typeof mapMatriculaReenviarCobrancaResultToDTO>;
};

type ResendFailure = {
  kind: 'FAILURE';
  status: 400 | 404 | 409 | 500;
  body: Record<string, unknown>;
};

export type ResendEnrollmentChargeResult = ResendSuccess | ResendFailure;

function getEffectivePaymentStatus(payment: {
  status?: string | null;
  billingType?: string | null;
  deleted?: boolean | null;
}) {
  return normalizeAsaasPaymentSnapshotStatus({
    status: payment.status,
    billingType: payment.billingType,
    deleted: payment.deleted,
  }) ?? payment.status ?? null;
}

function success(params: {
  message: string;
  asaasPaymentId: string;
  status?: string | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  pixQrCode?: { encodedImage?: string | null; payload?: string | null } | null;
}): ResendSuccess {
  return {
    kind: 'SUCCESS',
    data: mapMatriculaReenviarCobrancaResultToDTO({
      success: true,
      message: params.message,
      asaasPaymentId: params.asaasPaymentId,
      status: params.status,
      invoiceUrl: params.invoiceUrl,
      bankSlipUrl: params.bankSlipUrl,
      pixQrCodeUrl: params.pixQrCode?.encodedImage
        ? `data:image/png;base64,${params.pixQrCode.encodedImage}`
        : null,
      pixCopyPaste: params.pixQrCode?.payload || null,
    }),
  };
}

function failure(status: ResendFailure['status'], body: Record<string, unknown>): ResendFailure {
  return { kind: 'FAILURE', status, body };
}

async function updateChargeStatus(params: { id: string; contaId: string; status: StatusCobranca }) {
  const data = { status: params.status, updatedAt: new Date() };
  // Em produção a atualização é tenant-scoped. O fallback mantém compatibilidade
  // com doubles mínimos usados por testes antigos, sem alterar o caminho real.
  if (typeof matriculaRouteRepository.cobranca.updateMany === 'function') {
    await matriculaRouteRepository.cobranca.updateMany({
      where: { id: params.id, contaId: params.contaId },
      data,
    });
    return;
  }
  await matriculaRouteRepository.cobranca.update({ where: { id: params.id }, data });
}

export async function resendEnrollmentCharge(params: {
  matriculaId: string;
  contaId: string;
  userId: string;
}): Promise<ResendEnrollmentChargeResult> {
  const matricula = await matriculaRouteRepository.matricula.findFirst({
    where: { id: params.matriculaId, aluno: { contaId: params.contaId } },
    select: {
      id: true,
      taxaIsenta: true,
      taxaMatricula: true,
      dataInicio: true,
      asaasSubscriptionId: true,
      cobrancas: {
        where: { status: { in: [StatusCobranca.PENDENTE, StatusCobranca.A_VENCER, StatusCobranca.ATRASADO] } },
        orderBy: { vencimento: 'asc' },
        take: 1,
      },
      aluno: {
        select: {
          id: true,
          nome: true,
          email: true,
          cpf: true,
          telefone: true,
          dataNasc: true,
          asaasCustomerId: true,
          responsaveis: {
            select: {
              responsavel: {
                select: {
                  id: true,
                  nome: true,
                  cpf: true,
                  email: true,
                  telefone: true,
                  financeiro: true,
                  asaasCustomerId: true,
                },
              },
            },
          },
        },
      },
      responsavelFinanceiro: {
        select: {
          id: true,
          nome: true,
          cpf: true,
          email: true,
          telefone: true,
          financeiro: true,
          asaasCustomerId: true,
        },
      },
    },
  });

  if (!matricula) return failure(404, { error: 'Matrícula não encontrada' });
  const cobranca = matricula.cobrancas[0];
  if (!cobranca) return failure(404, { error: 'Nenhuma cobrança pendente encontrada' });

  if (cobranca.asaasPaymentId) {
    try {
      const { payment, pixQrCode } = await getAsaasPaymentDetails({
        paymentId: cobranca.asaasPaymentId,
        contaId: params.contaId,
        includePixQrCode: true,
      });
      if (payment.status) {
        await updateChargeStatus({
          id: cobranca.id,
          contaId: params.contaId,
          status: mapAsaasPaymentStatusToCobranca(payment.status, { dueDate: cobranca.vencimento }),
        });
      }
      return success({
        message: 'Link de cobrança obtido com sucesso',
        asaasPaymentId: cobranca.asaasPaymentId,
        status: payment.status,
        invoiceUrl: payment.invoiceUrl,
        bankSlipUrl: payment.bankSlipUrl,
        pixQrCode,
      });
    } catch (error) {
      console.error('[Reenviar Cobrança] Erro ao buscar via Asaas:', error);
      return failure(500, { error: 'Erro ao buscar cobrança via Asaas', details: undefined });
    }
  }

  if (cobranca.tipo === 'MENSALIDADE' && matricula.asaasSubscriptionId) {
    const materializedPayment = await materializeSubscriptionPaymentForCharge({
      prisma: matriculaRouteRepository,
      contaId: params.contaId,
      asaasSubscriptionId: matricula.asaasSubscriptionId,
      cobranca: { id: cobranca.id, vencimento: cobranca.vencimento, asaasPaymentId: cobranca.asaasPaymentId },
      intent: 'MANUAL_REPAIR',
    });
    if (!materializedPayment.found) {
      return failure(409, {
        error: 'ASSINATURA_PENDENTE_SINCRONIZACAO',
        message: 'A assinatura já existe, mas o payment deste ciclo ainda não foi materializado pelo Asaas. Aguarde a sincronização automática e tente novamente.',
      });
    }
    if (!materializedPayment.payment) {
      return failure(409, {
        error: 'ASSINATURA_PENDENTE_SINCRONIZACAO',
        message: 'A assinatura já existe, mas o payment deste ciclo ainda não pôde ser resolvido localmente. Tente novamente após a sincronização.',
      });
    }
    const { payment, pixQrCode } = await getAsaasPaymentDetails({
      paymentId: materializedPayment.payment.id,
      contaId: params.contaId,
      includePixQrCode: cobranca.formaPagamento === 'PIX',
    });
    return success({
      message: 'Cobrança recorrente sincronizada com sucesso',
      asaasPaymentId: payment.id,
      status: getEffectivePaymentStatus(payment),
      invoiceUrl: payment.invoiceUrl,
      bankSlipUrl: payment.bankSlipUrl,
      pixQrCode,
    });
  }

  try {
    const chargeResult = await createCharge({
      contaId: params.contaId,
      cobrancaId: cobranca.id,
      actor: { type: 'USER', id: params.userId },
    });
    let asaasPaymentId = chargeResult.success ? chargeResult.data.asaasPaymentId ?? null : null;
    if (!chargeResult.success && chargeResult.error === 'KYC_NAO_APROVADO') {
      return failure(409, { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' });
    }
    if (!chargeResult.success && chargeResult.error === 'COBRANCA_JA_POSSUI_PAGAMENTO') {
      const refreshed = await matriculaRouteRepository.cobranca.findUnique({
        where: { id: cobranca.id },
      });
      asaasPaymentId = refreshed?.asaasPaymentId ?? null;
      if (!asaasPaymentId) return failure(409, { error: chargeResult.error });
    } else if (!chargeResult.success) {
      return failure(500, { error: chargeResult.error });
    }
    if (!asaasPaymentId) return failure(500, { error: 'ASAAS_PAYMENT_ID_NAO_RETORNADO' });

    await syncPaymentStateFromAsaas({
      contaId: params.contaId,
      asaasPaymentId,
      eventName: 'PAYMENT_CREATED',
    }).catch((syncError) => {
      console.warn('[Reenviar Cobrança] syncPaymentStateFromAsaas falhou (não crítico)', syncError);
    });
    const { payment, pixQrCode } = await getAsaasPaymentDetails({
      paymentId: asaasPaymentId,
      contaId: params.contaId,
      includePixQrCode: cobranca.formaPagamento === 'PIX',
    });
    return success({
      message: 'Cobrança obtida do Asaas com sucesso',
      asaasPaymentId: payment.id,
      status: getEffectivePaymentStatus(payment),
      invoiceUrl: payment.invoiceUrl,
      bankSlipUrl: payment.bankSlipUrl,
      pixQrCode,
    });
  } catch (error) {
    if (error instanceof KycNotApprovedError) {
      return failure(409, { error: 'KYC_NAO_APROVADO', message: 'Conta não aprovada para operações financeiras' });
    }
    console.error('[Reenviar Cobrança] Erro ao provisionar cobrança via createCharge:', error);
    return failure(500, { error: 'Erro ao criar cobrança no Asaas', details: undefined });
  }
}

export function parseResendEnrollmentChargeResponse(result: ResendSuccess) {
  return matriculaReenviarCobrancaResultDTOSchema.parse(result.data);
}
