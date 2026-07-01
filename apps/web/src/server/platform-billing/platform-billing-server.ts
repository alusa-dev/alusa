import { NextResponse } from 'next/server';
import { parseStripeEnvironment, type StripeEnvironment } from '@alusa/stripe';
import type { PlatformPlanCode } from '@alusa/platform-billing';
import { getMaxActiveStudents } from '@alusa/platform-billing';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';

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
      select: { id: true, nome: true, email: true, role: true },
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
      select: { id: true, nome: true },
    }),
  ]);

  const role = (membership?.role ?? user?.role ?? '').toString().toUpperCase();
  return {
    user,
    conta,
    role,
    canManagePlatformBilling: PLATFORM_BILLING_MANAGE_ROLES.has(role),
  };
}

export async function countActivePlatformBillingStudents(params: {
  tx: TenantTransactionClient;
  contaId: string;
}): Promise<number> {
  const rows = await params.tx.matricula.findMany({
    where: {
      contaId: params.contaId,
      status: 'ATIVA',
      aluno: {
        status: 'ATIVO',
      },
    },
    distinct: ['alunoId'],
    select: { alunoId: true },
  });

  return rows.length;
}

export function assertCanManagePlatformBilling(canManage: boolean): NextResponse | null {
  if (canManage) return null;
  return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });
}

export function assertPlanCapacity(params: {
  planCode: PlatformPlanCode;
  activeStudents: number;
}): NextResponse | null {
  const maxStudents = getMaxActiveStudents(params.planCode);
  if (maxStudents === null || params.activeStudents <= maxStudents) return null;

  return NextResponse.json(
    {
      error: 'PLANO_INSUFICIENTE',
      message: `Este plano permite até ${maxStudents} alunos ativos.`,
      activeStudents: params.activeStudents,
      maxActiveStudents: maxStudents,
    },
    { status: 422 },
  );
}
