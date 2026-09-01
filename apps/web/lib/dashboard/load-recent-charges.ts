import { resolveAlunoPublicAvatar } from '@/lib/media/avatar-url';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';

export type RecentChargeReadModelRow = {
  id: string;
  sourceKind: string;
  sourceId: string;
  asaasPaymentId: string | null;
  alunoId: string | null;
  payerName: string;
  value: unknown;
  dueDate: Date | null;
  status: string;
  createdAt: Date;
};

function sourcePriority(sourceKind: string): number {
  // A Charge is the provider-backed record. Prefer it when the same Asaas
  // payment is also projected from the legacy academic Cobranca record.
  return sourceKind === 'CHARGE' ? 2 : 1;
}

export function dedupeRecentChargeRows(rows: RecentChargeReadModelRow[]) {
  const byProviderPayment = new Map<string, RecentChargeReadModelRow>();

  for (const row of rows) {
    if (!row.asaasPaymentId) continue;

    const current = byProviderPayment.get(row.asaasPaymentId);
    if (!current || sourcePriority(row.sourceKind) > sourcePriority(current.sourceKind)) {
      byProviderPayment.set(row.asaasPaymentId, row);
    }
  }

  return Array.from(byProviderPayment.values()).sort((first, second) => {
    const createdAtDiff = second.createdAt.getTime() - first.createdAt.getTime();
    if (createdAtDiff !== 0) return createdAtDiff;
    return second.id.localeCompare(first.id);
  });
}

export async function loadRecentDashboardCharges(
  tx: TenantTransactionClient,
  contaId: string,
  limit = 5,
) {
  const rows = await tx.chargeReadModel.findMany({
    where: {
      contaId,
      asaasPaymentId: { not: null },
      dueDate: { not: null },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // One Asaas payment can have both a provider-backed Charge projection and
    // a legacy Cobranca projection. Read a small buffer before deduplication.
    take: Math.max(limit * 6, 30),
    select: {
      id: true,
      sourceKind: true,
      sourceId: true,
      asaasPaymentId: true,
      alunoId: true,
      payerName: true,
      value: true,
      dueDate: true,
      status: true,
      createdAt: true,
    },
  });

  const uniqueRows = dedupeRecentChargeRows(rows)
    .filter((row): row is RecentChargeReadModelRow & { dueDate: Date } => row.dueDate !== null)
    .slice(0, limit);
  const alunoIds = uniqueRows.flatMap((row) => (row.alunoId ? [row.alunoId] : []));
  const alunos = alunoIds.length
    ? await tx.aluno.findMany({
        where: { contaId, id: { in: alunoIds } },
        select: { id: true, nome: true, foto: true },
      })
    : [];
  const alunoById = new Map(alunos.map((aluno) => [aluno.id, aluno]));

  return uniqueRows.map((row) => {
    const aluno = row.alunoId ? alunoById.get(row.alunoId) : undefined;
    const alunoAvatarUrl = aluno ? resolveAlunoPublicAvatar(aluno) : null;

    return {
      id: row.id,
      alunoId: row.alunoId ?? undefined,
      aluno: aluno?.nome ?? row.payerName,
      alunoAvatarUrl,
      valor: Number(row.value),
      vencimento: row.dueDate.toISOString(),
      status: row.status,
    };
  });
}
