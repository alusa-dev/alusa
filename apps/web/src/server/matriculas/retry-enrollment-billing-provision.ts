import {
  BillingMode,
  MatriculaBillingProvisionStatus,
} from '@prisma/client';
import { prisma } from '@/src/prisma';
import { provisionIndividualEnrollmentBilling } from '@/src/server/matriculas/enrollment-billing.orchestrator';
import { calcularPrecoMatricula } from '@/src/server/matriculas/matricula.service';

const DEFAULT_MIN_AGE_MINUTES = 5;
const DEFAULT_LIMIT = 25;

export type RetryEnrollmentBillingProvisionInput = {
  contaId?: string;
  minAgeMinutes?: number;
  limit?: number;
  dryRun?: boolean;
};

export type RetryEnrollmentBillingProvisionResult = {
  scanned: number;
  retried: number;
  recovered: number;
  skipped: number;
  errors: Array<{ matriculaId: string; error: string }>;
};

function needsBillingRetry(status: MatriculaBillingProvisionStatus) {
  return (
    status === MatriculaBillingProvisionStatus.PENDENTE ||
    status === MatriculaBillingProvisionStatus.PARCIAL ||
    status === MatriculaBillingProvisionStatus.FALHO ||
    status === MatriculaBillingProvisionStatus.PROCESSANDO
  );
}

export async function retryEnrollmentBillingProvisionJob(
  input: RetryEnrollmentBillingProvisionInput = {},
): Promise<RetryEnrollmentBillingProvisionResult> {
  const minAgeMinutes = Math.max(1, input.minAgeMinutes ?? DEFAULT_MIN_AGE_MINUTES);
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 100));
  const threshold = new Date(Date.now() - minAgeMinutes * 60 * 1000);

  const result: RetryEnrollmentBillingProvisionResult = {
    scanned: 0,
    retried: 0,
    recovered: 0,
    skipped: 0,
    errors: [],
  };

  const candidates = await prisma.matricula.findMany({
    where: {
      billingMode: BillingMode.INDIVIDUAL,
      billingProvisionStatus: {
        in: [
          MatriculaBillingProvisionStatus.PENDENTE,
          MatriculaBillingProvisionStatus.PARCIAL,
          MatriculaBillingProvisionStatus.FALHO,
          MatriculaBillingProvisionStatus.PROCESSANDO,
        ],
      },
      createdAt: { lt: threshold },
      ...(input.contaId ? { contaId: input.contaId } : {}),
    },
    include: {
      cobrancas: {
        where: { tipo: 'TAXA_MATRICULA' },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
      descontos: { include: { desconto: true } },
      plano: { select: { valor: true } },
      combo: { select: { valor: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  result.scanned = candidates.length;

  for (const matricula of candidates) {
    if (!needsBillingRetry(matricula.billingProvisionStatus)) {
      result.skipped += 1;
      continue;
    }

    const planoValor = matricula.combo
      ? Number(matricula.combo.valor)
      : matricula.plano
        ? Number(matricula.plano.valor)
        : Number(matricula.taxaMatricula);

    const preco = calcularPrecoMatricula({
      planoValor,
      taxaMatricula: Number(matricula.taxaMatricula),
      descontos: matricula.descontos.map((item) => ({
        tipo: item.desconto.tipo === 'PERCENTUAL' ? ('PERCENTUAL' as const) : ('FIXO' as const),
        valor: Number(item.desconto.valor),
        cumulativo: false,
      })),
    });

    const gerarCobrancaTaxa =
      !matricula.taxaIsenta && Number(matricula.taxaMatricula) > 0 && Boolean(matricula.cobrancas[0]);
    const criarCobranca = preco.planoLiquido > 0;

    if (!gerarCobrancaTaxa && !criarCobranca) {
      result.skipped += 1;
      continue;
    }

    if (input.dryRun) {
      result.retried += 1;
      continue;
    }

    try {
      const outcome = await provisionIndividualEnrollmentBilling({
        contaId: matricula.contaId,
        actorUserId: 'retry-enrollment-billing-job',
        matriculaId: matricula.id,
        payload: {
          criarCobranca,
          gerarCobrancaTaxa,
          taxaIsenta: matricula.taxaIsenta,
        },
        preco,
        cobrancas: {
          taxa: matricula.cobrancas[0]
            ? {
                id: matricula.cobrancas[0].id,
                formaPagamento: matricula.cobrancas[0].formaPagamento,
                asaasPaymentId: matricula.cobrancas[0].asaasPaymentId,
              }
            : null,
          mensalidade: null,
        },
        matriculaSnapshot: {
          asaasSubscriptionId: matricula.asaasSubscriptionId,
        },
      });

      result.retried += 1;
      const provisioned =
        outcome.subscriptionSync?.success === true ||
        (outcome.taxaSync?.success === true && !criarCobranca);
      if (provisioned) {
        result.recovered += 1;
      }
    } catch (error) {
      result.errors.push({
        matriculaId: matricula.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.info('[retry-enrollment-billing]', result);
  return result;
}
