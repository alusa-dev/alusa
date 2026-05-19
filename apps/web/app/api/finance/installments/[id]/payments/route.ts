import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import {
  cancelInstallmentPayments,
  getInstallment,
  KycNotApprovedError,
} from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function buildPaymentReferencePrefix(externalReference: string) {
  return `${externalReference}:payment:`;
}

async function convergeAcademicInstallmentCancellation(params: {
  contaId: string;
  planId: string;
  externalReference: string;
  now: Date;
}) {
  const linkedCharges = await prisma.charge.findMany({
    where: {
      contaId: params.contaId,
      OR: [
        { externalReference: params.externalReference },
        { externalReference: { startsWith: buildPaymentReferencePrefix(params.externalReference) } },
      ],
    },
    select: { id: true, cobrancaId: true },
  });

  const cobrancaIds = linkedCharges
    .map((charge) => charge.cobrancaId)
    .filter((value): value is string => Boolean(value));

  await prisma.$transaction([
    prisma.installmentPlan.update({
      where: { id: params.planId },
      data: { status: 'CANCELED', statusUpdatedAt: params.now },
    }),
    prisma.charge.updateMany({
      where: {
        id: { in: linkedCharges.map((charge) => charge.id) },
        status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
      },
      data: { status: 'CANCELED' },
    }),
    prisma.cobranca.updateMany({
      where: {
        id: { in: cobrancaIds },
        status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
      },
      data: { status: 'CANCELADO' },
    }),
  ]);
}

async function convergeStandaloneInstallmentCancellation(params: {
  planId: string;
  now: Date;
}) {
  await prisma.$transaction([
    prisma.standaloneInstallmentPlan.update({
      where: { id: params.planId },
      data: { status: 'CANCELED', statusUpdatedAt: params.now },
    }),
    prisma.charge.updateMany({
      where: {
        standaloneInstallmentPlanId: params.planId,
        status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
      },
      data: { status: 'CANCELED' },
    }),
  ]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
    const rawParams = await params;
  try {
    const session = await getServerSession(authOptions);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;

    if (!user?.id || !user?.contaId) {
      return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const academicPlan = await prisma.installmentPlan.findFirst({
      where: { id: rawParams.id, contaId: user.contaId },
      select: { id: true, asaasInstallmentId: true, status: true, externalReference: true },
    });

    const standalonePlan = !academicPlan
      ? await prisma.standaloneInstallmentPlan.findFirst({
          where: { id: rawParams.id, contaId: user.contaId },
          select: { id: true, asaasInstallmentId: true, status: true, externalReference: true },
        })
      : null;

    const plan = academicPlan ?? standalonePlan;
    if (!plan) {
      return err(404, 'NAO_ENCONTRADO', 'Parcelamento não encontrado');
    }

    if (!plan.asaasInstallmentId) {
      return err(400, 'SEM_VINCULO_ASAAS', 'Parcelamento sem vínculo com a plataforma financeira');
    }

    const remote = await getInstallment(plan.asaasInstallmentId, { contaId: user.contaId });
    if (remote.deleted === true || plan.status === 'CANCELED') {
      const now = new Date();
      if (academicPlan) {
        await convergeAcademicInstallmentCancellation({
          contaId: user.contaId,
          planId: academicPlan.id,
          externalReference: academicPlan.externalReference,
          now,
        });
      } else {
        await convergeStandaloneInstallmentCancellation({
          planId: standalonePlan!.id,
          now,
        });
      }

      return NextResponse.json(
        { success: true, message: 'Parcelamento já estava cancelado na plataforma financeira.' },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const result = await cancelInstallmentPayments(plan.asaasInstallmentId, { contaId: user.contaId });
    const now = new Date();

    if (academicPlan) {
      await convergeAcademicInstallmentCancellation({
        contaId: user.contaId,
        planId: academicPlan.id,
        externalReference: academicPlan.externalReference,
        now,
      });
    } else {
      await convergeStandaloneInstallmentCancellation({
        planId: standalonePlan!.id,
        now,
      });
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Cobranças pendentes e vencidas do parcelamento canceladas com sucesso.',
        data: {
          id: result.id,
          deletedPayments: result.deletedPayments ?? [],
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof KycNotApprovedError) {
      return err(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }

    console.error('[API Installment Payments Delete] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}