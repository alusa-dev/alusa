import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { buildChargeDisplayStatusDTO } from '@/lib/finance/charge-display-status';

export type ListFinanceiroPagamentosInput = {
  contaId: string;
  page: number;
  pageSize: number;
  status: string[];
  formaPagamento: string[];
  cobrancaId?: string;
  search?: string;
};

export async function listFinanceiroPagamentos(input: ListFinanceiroPagamentosInput) {
  const where: Prisma.PagamentoWhereInput = {
    contaId: input.contaId,
    cobranca: { matricula: { aluno: { contaId: input.contaId } } },
  };
  if (input.status.length) where.status = { in: input.status };
  if (input.formaPagamento.length) where.formaPagamento = { in: input.formaPagamento };
  if (input.cobrancaId) where.cobrancaId = input.cobrancaId;
  if (input.search) {
    where.OR = [
      { cobranca: { matricula: { aluno: { nome: { contains: input.search, mode: 'insensitive' } } } } },
      { cobranca: { descricao: { contains: input.search, mode: 'insensitive' } } },
    ];
  }

  const [total, pagamentos] = await Promise.all([
    prisma.pagamento.count({ where }),
    prisma.pagamento.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      include: {
        cobranca: {
          include: {
            matricula: { select: { aluno: { select: { id: true, nome: true } }, id: true } },
          },
        },
      },
    }),
  ]);

  const data = pagamentos.map((payment) => ({
    id: payment.id,
    status: payment.status,
    valorPago: Number(payment.valorPago),
    dataPagamento: payment.dataPagamento?.toISOString() ?? null,
    formaPagamento: payment.formaPagamento,
    cobrancaId: payment.cobrancaId,
    cobranca: {
      id: payment.cobranca.id,
      tipo: payment.cobranca.tipo,
      status: payment.cobranca.status,
      valor: Number(payment.cobranca.valor),
      vencimento: payment.cobranca.vencimento.toISOString(),
      aluno: {
        id: payment.cobranca.matricula.aluno.id,
        nome: payment.cobranca.matricula.aluno.nome,
      },
      displayStatus: buildChargeDisplayStatusDTO({
        localStatus: payment.cobranca.status,
        asaasStatus: payment.cobranca.asaasStatus,
        liquidacaoStatus: payment.cobranca.liquidacaoStatus,
        hasAsaasLink: Boolean(
          payment.cobranca.asaasPaymentId ||
            payment.cobranca.asaasStatus ||
            payment.cobranca.liquidacaoStatus,
        ),
      }),
    },
    asaasPaymentId: payment.asaasPaymentId,
    createdAt: payment.createdAt.toISOString(),
  }));

  return { data, total };
}
