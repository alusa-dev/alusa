// Este módulo também é carregado por jobs/tsx fora do bundler do Next.
// O sufixo explícito mantém a resolução ESM válida nesses dois ambientes.
import { NextResponse } from 'next/server.js';
import { parseStripeEnvironment, type StripeEnvironment } from '@alusa/stripe';
import { hasBillableMonthlyEnrollment } from '@alusa/platform-billing';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
import { isAcademicDateInFuture } from '@alusa/shared/date-only';

const PLATFORM_BILLING_MANAGE_ROLES = new Set(['ADMIN', 'FINANCEIRO']);

export function resolvePlatformBillingEnvironment(): StripeEnvironment {
  return parseStripeEnvironment(process.env.STRIPE_ENVIRONMENT ?? 'TEST');
}

export async function resolvePlatformBillingActor(params: {
  tx: TenantTransactionClient;
  contaId: string;
  userId: string;
}) {
  const [user, membership, conta] = await Promise.all([
    params.tx.usuario.findFirst({
      where: {
        id: params.userId,
        contaId: params.contaId,
      },
      select: { id: true, nome: true, email: true, role: true, status: true },
    }),
    params.tx.usuarioConta.findUnique({
      where: {
        usuarioId_contaId: {
          usuarioId: params.userId,
          contaId: params.contaId,
        },
      },
      select: { role: true, status: true },
    }),
    params.tx.conta.findUnique({
      where: { id: params.contaId },
      select: { id: true, nome: true, status: true, deletedAt: true },
    }),
  ]);

  const role = (membership?.role ?? '').toString().toUpperCase();
  const activeAuthorizationContext =
    user?.status === 'ATIVO' &&
    membership?.status === 'ATIVO' &&
    conta?.status === 'ATIVO' &&
    !conta.deletedAt;
  return {
    user,
    conta,
    role,
    canManagePlatformBilling: activeAuthorizationContext && PLATFORM_BILLING_MANAGE_ROLES.has(role),
  };
}

export async function countActivePlatformBillingStudents(params: {
  tx: TenantTransactionClient;
  contaId: string;
}): Promise<number> {
  const account = await params.tx.conta.findUnique({
    where: { id: params.contaId },
    select: { timezone: true },
  });
  const rows = await params.tx.matricula.findMany({
    where: {
      contaId: params.contaId,
      status: 'ATIVA',
      aluno: {
        status: 'ATIVO',
      },
    },
    select: {
      alunoId: true,
      dataInicio: true,
      plano: { select: { valor: true, periodicidade: true } },
      combo: { select: { valor: true, periodicidade: true } },
      descontos: { select: { valorFinal: true } },
    },
  });

  return new Set(rows
    .filter((row) => {
      const effective = !isAcademicDateInFuture(row.dataInicio, new Date(), account?.timezone ?? undefined);
      const recurring = row.combo ?? row.plano;
      const amountCents = recurring?.periodicidade === 'MENSAL'
        ? Math.round(Number(recurring.valor) * 100)
        : null;
      const discountCents = row.descontos.reduce((sum, discount) => sum + Math.round(Number(discount.valorFinal) * 100), 0);
      return hasBillableMonthlyEnrollment({
        active: true,
        effective,
        monthlyAmountCents: amountCents,
        fullScholarship: amountCents !== null && amountCents > 0 && discountCents >= amountCents,
      });
    })
    .map((row) => row.alunoId)).size;
}

export function assertCanManagePlatformBilling(canManage: boolean): NextResponse | null {
  if (canManage) return null;
  return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });
}
