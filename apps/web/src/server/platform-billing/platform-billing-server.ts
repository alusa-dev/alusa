// Este módulo também é carregado por jobs/tsx fora do bundler do Next.
// O sufixo explícito mantém a resolução ESM válida nesses dois ambientes.
import { NextResponse } from 'next/server.js';
import { parseStripeEnvironment, type StripeEnvironment } from '@alusa/stripe';
import type { PlatformPlanCode } from '@alusa/platform-billing';
import { evaluateStudentCapacity } from '@alusa/platform-billing';
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
    select: { alunoId: true, dataInicio: true },
  });

  return new Set(rows
    .filter((row) => !isAcademicDateInFuture(row.dataInicio, new Date(), account?.timezone ?? undefined))
    .map((row) => row.alunoId)).size;
}

export function assertCanManagePlatformBilling(canManage: boolean): NextResponse | null {
  if (canManage) return null;
  return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });
}

export function assertPlanCapacity(params: {
  planCode: PlatformPlanCode;
  activeStudents: number;
}): NextResponse | null {
  const capacity = evaluateStudentCapacity({
    contaId: 'platform-billing-checkout',
    planCode: params.planCode,
    activeStudents: params.activeStudents,
    additionalActiveStudents: 0,
  });
  if (capacity.allowed) return null;
  const maxStudents = capacity.maxActiveStudents;

  return NextResponse.json(
    {
      error: 'PLANO_INSUFICIENTE',
      message: `Este plano permite até ${maxStudents} alunos ativos.`,
      activeStudents: capacity.activeStudents,
      maxActiveStudents: capacity.maxActiveStudents,
      recommendedPlanCode: capacity.recommendedPlanCode,
    },
    { status: 422 },
  );
}
