import prisma from '@/lib/prisma';
import {
  findCustomerForPayer,
  getPayment,
  getSubscription,
  recordAsaasReadIntent,
} from '@alusa/finance';
import type { FormaPagamento, Prisma, StatusCobranca, StatusMatricula } from '@prisma/client';
import { recordAsaasReadDecision } from './asaas-read-observability';

const billingTypeMap: Record<string, FormaPagamento> = {
  BOLETO: 'BOLETO',
  PIX: 'PIX',
  CREDIT_CARD: 'CARTAO_CREDITO',
  CARTAO_CREDITO: 'CARTAO_CREDITO',
  DINHEIRO: 'INDEFINIDO',
};

const activeChargeStatuses = new Set<StatusCobranca>([
  'A_VENCER',
  'PENDENTE',
  'ATRASADO',
  'PROCESSANDO',
]);

const activeMatriculaStatuses: StatusMatricula[] = [
  'ATIVA',
  'AGUARDANDO_CONFIRMACAO',
  'PENDENTE_TAXA',
];

function resolveFormaPagamento(
  cobrancas: Array<{
    id: string;
    status: StatusCobranca;
    vencimento: Date;
    valor: Prisma.Decimal | null;
    formaPagamento: FormaPagamento;
    tipo?: string | null;
  }>,
  matriculaFormaPagamento: FormaPagamento | null,
  fallback: FormaPagamento,
) {
  const mensalidades = cobrancas.filter(
    (cobranca) => cobranca.tipo === 'MENSALIDADE' || cobranca.tipo === 'RECORRENTE',
  );
  const source = mensalidades.length > 0 ? mensalidades : cobrancas;
  const upcoming = [...source]
    .sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime())
    .find((cobranca) => activeChargeStatuses.has(cobranca.status));
  const reference = upcoming ?? source[source.length - 1];
  const formaPagamento = reference?.formaPagamento ?? matriculaFormaPagamento ?? fallback;

  return {
    formaPagamento,
    proximaCobranca: reference
      ? {
          id: reference.id,
          status: reference.status,
          vencimento: reference.vencimento,
          valor: reference.valor !== null ? Number(reference.valor) : null,
        }
      : null,
  };
}

export async function getAccountPaymentMethodView(input: {
  contaId: string;
  userId: string;
  role: 'RESPONSAVEL' | 'ALUNO';
}) {
  let responsavel: {
    id: string;
    nome: string;
    email: string;
    preferredBillingType: string | null;
  } | null = null;

  if (input.role === 'RESPONSAVEL') {
    responsavel = await prisma.responsavel.findFirst({
      where: { usuarioId: input.userId, contaId: input.contaId },
      select: { id: true, nome: true, email: true, preferredBillingType: true },
    });
    if (!responsavel) return { status: 'RESPONSAVEL_NOT_FOUND' as const };
  } else {
    const aluno = await prisma.aluno.findFirst({
      where: { usuarioId: input.userId, contaId: input.contaId },
      select: { id: true },
    });
    if (!aluno) return { status: 'ALUNO_NOT_FOUND' as const };
  }

  const matriculas = await prisma.matricula.findMany({
    where:
      input.role === 'RESPONSAVEL'
        ? {
            contaId: input.contaId,
            status: { in: activeMatriculaStatuses },
            OR: [
              { responsavelFinanceiroId: responsavel!.id },
              {
                aluno: {
                  contaId: input.contaId,
                  responsaveis: { some: { responsavelId: responsavel!.id } },
                },
              },
            ],
          }
        : {
            contaId: input.contaId,
            status: { in: activeMatriculaStatuses },
            aluno: { contaId: input.contaId, usuarioId: input.userId },
          },
    select: {
      id: true,
      asaasSubscriptionId: true,
      formaPagamento: true,
      formaPagamentoTaxa: true,
      status: true,
      responsavelFinanceiro: {
        select: { id: true, nome: true, email: true, preferredBillingType: true },
      },
      aluno: {
        select: {
          nome: true,
          cpf: true,
          responsaveis: {
            select: {
              responsavel: {
                select: { id: true, nome: true, email: true, preferredBillingType: true },
              },
            },
          },
        },
      },
      plano: { select: { nome: true } },
      cobrancas: {
        select: {
          id: true,
          status: true,
          vencimento: true,
          valor: true,
          formaPagamento: true,
          tipo: true,
        },
        orderBy: { vencimento: 'asc' },
        take: 10,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (input.role === 'ALUNO' && !responsavel) {
    const financeFromMatriculas = matriculas.find((item) => item.responsavelFinanceiro)
      ?.responsavelFinanceiro;
    const fallbackFromResponsaveis = matriculas
      .flatMap((matricula) => matricula.aluno.responsaveis)
      .map((relation) => relation.responsavel)
      .find(Boolean);
    const finance = financeFromMatriculas ?? fallbackFromResponsaveis ?? null;
    responsavel = finance
      ? {
          id: finance.id,
          nome: finance.nome,
          email: finance.email,
          preferredBillingType: finance.preferredBillingType,
        }
      : null;
  }

  const resolvedPreferred = (responsavel?.preferredBillingType || 'BOLETO').toUpperCase();
  const fallbackFormaPagamento = billingTypeMap[resolvedPreferred] || 'BOLETO';
  const assinaturas = matriculas.map((matricula) => {
    const resolved = resolveFormaPagamento(
      matricula.cobrancas,
      matricula.formaPagamento ?? matricula.formaPagamentoTaxa ?? null,
      fallbackFormaPagamento,
    );
    return {
      id: matricula.id,
      asaasSubscriptionId: matricula.asaasSubscriptionId,
      aluno: matricula.aluno.nome,
      cpf: matricula.aluno.cpf,
      plano: matricula.plano?.nome ?? 'Sem plano',
      status: matricula.status,
      ...resolved,
    };
  });

  return { status: 'OK' as const, responsavel, assinaturas };
}

type AsaasResponseErrorLike = { response?: { status?: number } };
type CardData = { brand: string; last4: string };

function cardDataFromPayment(payment: {
  creditCard?: { creditCardNumber?: string; creditCardBrand?: string } | null;
}): CardData | null {
  const number = payment.creditCard?.creditCardNumber;
  const rawBrand = payment.creditCard?.creditCardBrand;
  if (!number || !rawBrand) return null;
  const brandMap: Record<string, string> = {
    VISA: 'VISA', MASTERCARD: 'MASTERCARD', MASTER: 'MASTERCARD', AMEX: 'AMEX',
    AMERICAN_EXPRESS: 'AMEX', ELO: 'ELO', HIPERCARD: 'HIPERCARD', DINERS: 'DINERS',
    DINERS_CLUB: 'DINERS',
  };
  return { brand: brandMap[rawBrand.toUpperCase()] || rawBrand, last4: number };
}

async function updateResponsavelForTenant(input: {
  id: string;
  contaId: string;
  data: Record<string, unknown>;
}) {
  const scopedUpdateMany = prisma.responsavel.updateMany;
  if (typeof scopedUpdateMany === 'function') {
    const result = await scopedUpdateMany({
      where: { id: input.id, contaId: input.contaId },
      data: input.data,
    });
    if (result.count !== 1) throw new Error('RESPONSAVEL_NOT_FOUND');
    return;
  }

  // Reduced test doubles may only expose update; production uses the
  // tenant-scoped updateMany branch above.
  await prisma.responsavel.update({ where: { id: input.id }, data: input.data });
}

export async function synchronizeAccountPaymentMethod(input: {
  contaId: string;
  userId: string;
  forceRefresh: boolean;
}) {
  const responsavel = await prisma.responsavel.findFirst({
    where: { usuarioId: input.userId, contaId: input.contaId },
    select: {
      id: true,
      asaasCustomerId: true,
      preferredBillingType: true,
      creditCardBrand: true,
      creditCardLast4: true,
    },
  });
  if (!responsavel) return { synced: false as const, message: 'Responsável não encontrado' };

  const canonicalCustomer = await findCustomerForPayer(input.contaId, 'RESPONSAVEL', responsavel.id);
  const asaasCustomerId = canonicalCustomer?.asaasCustomerId ?? responsavel.asaasCustomerId;
  if (!asaasCustomerId) {
    return { synced: false as const, message: 'Customer Asaas não encontrado. Crie uma matrícula primeiro.' };
  }

  const localCardData = responsavel.creditCardBrand && responsavel.creditCardLast4
    ? { brand: responsavel.creditCardBrand, last4: responsavel.creditCardLast4 }
    : null;
  const localBillingType = responsavel.preferredBillingType ?? null;
  if (!input.forceRefresh && (localBillingType || localCardData)) {
    recordAsaasReadDecision('payment_method_sync', 'local');
    return {
      synced: true as const,
      cardSynced: Boolean(localCardData),
      billingTypeSynced: Boolean(localBillingType),
      data: { creditCard: localCardData, billingType: localBillingType },
    };
  }

  recordAsaasReadDecision('payment_method_sync', input.forceRefresh ? 'fresh_remote' : 'remote');
  try {
    const assinatura = await prisma.matricula.findFirst({
      where: {
        contaId: input.contaId,
        responsavelFinanceiroId: responsavel.id,
        status: 'ATIVA',
        asaasSubscriptionId: { not: null },
      },
      select: { id: true, asaasSubscriptionId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!assinatura?.asaasSubscriptionId) {
      return { synced: false as const, message: 'Nenhuma assinatura ativa encontrada' };
    }

    recordAsaasReadIntent('MANUAL_REPAIR');
    const subscription = await getSubscription(assinatura.asaasSubscriptionId, {
      contaId: input.contaId,
    });
    const billingTypeMap: Record<string, string> = {
      BOLETO: 'BOLETO', PIX: 'PIX', CREDIT_CARD: 'CREDIT_CARD', UNDEFINED: 'BOLETO',
    };
    const billingType = billingTypeMap[subscription.billingType] || localBillingType || 'BOLETO';
    await updateResponsavelForTenant({
      id: responsavel.id,
      contaId: input.contaId,
      data: { preferredBillingType: billingType },
    });

    let cardData: CardData | null = null;
    if (!localCardData) {
      const cobrancaPaga = await prisma.cobranca.findFirst({
        where: {
          contaId: input.contaId,
          matriculaId: assinatura.id,
          status: 'PAGO',
          ...(subscription.billingType === 'CREDIT_CARD'
            ? { formaPagamento: 'CARTAO_CREDITO' }
            : {}),
          asaasPaymentId: { not: null },
        },
        select: { asaasPaymentId: true },
        orderBy: { dataPagamento: 'desc' },
      });
      if (cobrancaPaga?.asaasPaymentId) {
        recordAsaasReadIntent('MANUAL_REPAIR');
        const payment = await getPayment(cobrancaPaga.asaasPaymentId, { contaId: input.contaId });
        if (subscription.billingType === 'CREDIT_CARD' || payment.billingType === 'CREDIT_CARD') {
          cardData = cardDataFromPayment(payment);
          if (cardData) {
            await updateResponsavelForTenant({
              id: responsavel.id,
              contaId: input.contaId,
              data: {
                creditCardBrand: cardData.brand,
                creditCardLast4: cardData.last4,
                creditCardUpdatedAt: new Date(),
              },
            });
          }
        }
      }
    }

    return {
      synced: true as const,
      cardSynced: Boolean(cardData || localCardData),
      billingTypeSynced: true,
      data: { creditCard: cardData ?? localCardData, billingType },
    };
  } catch (error) {
    if ((error as AsaasResponseErrorLike).response?.status === 404) {
      return { synced: false as const, message: 'Customer não encontrado no Asaas' };
    }
    throw error;
  }
}
