import { prisma } from '@alusa/database';

export type ListChargesInput = {
  contaId: string;
  limit?: number;
  offset?: number;
};

export type ChargeListItem = {
  id: string;
  cobrancaId: string | null;
  externalReference: string;
  status: string;
  statusUpdatedAt: string;
  asaasPaymentId: string | null;
  valor: number | null;
  vencimento: string | null;
  matriculaId: string | null;
  createdAt: string;
};

export async function listCharges(input: ListChargesInput): Promise<{ items: ChargeListItem[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);

  const where = {
    contaId: input.contaId,
  } as const;

  const [items, total] = await Promise.all([
    prisma.charge.findMany({
      where,
      select: {
        id: true,
        status: true,
        asaasPaymentId: true,
        externalReference: true,
        statusUpdatedAt: true,
        createdAt: true,
        cobranca: {
          select: {
            id: true,
            matriculaId: true,
            valor: true,
            vencimento: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.charge.count({ where }),
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      cobrancaId: item.cobranca?.id ?? null,
      externalReference: item.externalReference,
      status: item.status,
      statusUpdatedAt: item.statusUpdatedAt.toISOString(),
      asaasPaymentId: item.asaasPaymentId ?? null,
      valor: item.cobranca?.valor != null ? Number(item.cobranca.valor) : null,
      vencimento: item.cobranca?.vencimento ? item.cobranca.vencimento.toISOString() : null,
      matriculaId: item.cobranca?.matriculaId ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
    total,
  };
}
