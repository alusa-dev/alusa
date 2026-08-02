import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  deleteSubscription,
  getSubscriptionWithCharges,
  KycNotApprovedError,
} from '@alusa/finance';
import { prisma } from '@/lib/prisma';
import { classifyAsaasSubscriptionMutationError } from '@/src/server/finance/asaas-subscription-mutation-error';

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

async function convergeAcademicSubscriptionDeletion(params: {
  contaId: string;
  subscriptionId: string;
  billingAgreementId: string | null;
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

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: params.subscriptionId },
      data: { status: 'DELETED', statusUpdatedAt: params.now },
    });
    await tx.charge.updateMany({
      where: {
        id: { in: linkedCharges.map((charge) => charge.id) },
        status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
      },
      data: {
        status: 'CANCELED',
        statusUpdatedAt: params.now,
        asaasStatus: 'DELETED',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    });
    await tx.cobranca.updateMany({
      where: {
        id: { in: cobrancaIds },
        status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
      },
      data: {
        status: 'CANCELADO',
        asaasStatus: 'DELETED',
        canceladoEm: params.now,
        canceladoMotivo: 'Assinatura removida no Asaas',
        canceladoPor: 'system',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    });
    if (params.billingAgreementId) {
      await tx.billingAllocation.updateMany({
        where: { contaId: params.contaId, agreementId: params.billingAgreementId, status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] } },
        data: { status: 'CANCELLED', validUntil: params.now },
      });
      await tx.billingAgreement.updateMany({
        where: { id: params.billingAgreementId, contaId: params.contaId },
        data: {
          status: 'CANCELLED',
          desiredValue: 0,
          confirmedValue: 0,
          asaasSubscriptionId: null,
          remoteStatus: 'DELETED',
          remoteStatusUpdatedAt: params.now,
          lastReconciledAt: params.now,
          reconciliationError: null,
          version: { increment: 1 },
        },
      });
    }
  });
}

async function convergeStandaloneSubscriptionDeletion(params: {
  contaId: string;
  subscriptionId: string;
  billingAgreementId: string | null;
  externalReference: string;
  now: Date;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.standaloneSubscription.update({
      where: { id: params.subscriptionId },
      data: { status: 'DELETED', statusUpdatedAt: params.now },
    });
    await tx.charge.updateMany({
      where: {
        contaId: params.contaId,
        OR: [
          { standaloneSubscriptionId: params.subscriptionId },
          { externalReference: params.externalReference },
          { externalReference: { startsWith: buildPaymentReferencePrefix(params.externalReference) } },
        ],
        status: { in: ['CREATED', 'OPEN', 'OVERDUE'] },
      },
      data: {
        status: 'CANCELED',
        statusUpdatedAt: params.now,
        asaasStatus: 'DELETED',
        liquidacaoStatus: 'NAO_APLICAVEL',
      },
    });
    if (params.billingAgreementId) {
      await tx.billingAllocation.updateMany({
        where: { contaId: params.contaId, agreementId: params.billingAgreementId, status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] } },
        data: { status: 'CANCELLED', validUntil: params.now },
      });
      await tx.billingAgreement.updateMany({
        where: { id: params.billingAgreementId, contaId: params.contaId },
        data: {
          status: 'CANCELLED',
          desiredValue: 0,
          confirmedValue: 0,
          asaasSubscriptionId: null,
          remoteStatus: 'DELETED',
          remoteStatusUpdatedAt: params.now,
          lastReconciledAt: params.now,
          reconciliationError: null,
          version: { increment: 1 },
        },
      });
    }
  });
}

/**
 * GET /api/finance/subscriptions/[id]
 * Retorna detalhes de uma assinatura com cobranças vinculadas.
 */
export async function GET(
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

    const result = await getSubscriptionWithCharges({
      contaId: user.contaId,
      subscriptionId: rawParams.id,
    });

    if (!result.success) {
      return err(404, 'NAO_ENCONTRADO', result.error);
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Subscription Detail] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
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

    const academicSubscription = await prisma.subscription.findFirst({
      where: { id: rawParams.id, contaId: user.contaId },
      select: { id: true, billingAgreementId: true, asaasSubscriptionId: true, status: true, externalReference: true },
    });

    const standaloneSubscription = !academicSubscription
      ? await prisma.standaloneSubscription.findFirst({
          where: { id: rawParams.id, contaId: user.contaId },
          select: { id: true, billingAgreementId: true, asaasSubscriptionId: true, status: true, externalReference: true },
        })
      : null;

    const subscription = academicSubscription ?? standaloneSubscription;

    if (!subscription) {
      return err(404, 'NAO_ENCONTRADO', 'Assinatura não encontrada');
    }

    if (!subscription.asaasSubscriptionId) {
      return err(400, 'SEM_VINCULO_ASAAS', 'Assinatura sem vínculo com a plataforma financeira');
    }

    const now = new Date();
    let deleted:
      | {
          id: string;
          deleted?: boolean;
        }
      | null = null;

    try {
      deleted = await deleteSubscription(subscription.asaasSubscriptionId, { contaId: user.contaId });
    } catch (error) {
      const classified = classifyAsaasSubscriptionMutationError(error);
      if (classified.kind === 'not_found') {
        if (academicSubscription) {
          await convergeAcademicSubscriptionDeletion({
            contaId: user.contaId,
            subscriptionId: academicSubscription.id,
            billingAgreementId: academicSubscription.billingAgreementId,
            externalReference: academicSubscription.externalReference,
            now,
          });
        } else {
          await convergeStandaloneSubscriptionDeletion({
            contaId: user.contaId,
            subscriptionId: standaloneSubscription!.id,
            billingAgreementId: standaloneSubscription!.billingAgreementId,
            externalReference: standaloneSubscription!.externalReference,
            now,
          });
        }

        return NextResponse.json(
          { success: true, message: 'Assinatura já estava excluída na plataforma financeira.' },
          { headers: { 'cache-control': 'no-store' } },
        );
      }

      if (classified.kind === 'unauthorized') {
        return err(
          502,
          'FINANCEIRO_AUTENTICACAO_INVALIDA',
          classified.providerMessage ?? 'A conta financeira rejeitou a operação.',
        );
      }

      throw error;
    }

    if (academicSubscription) {
      await convergeAcademicSubscriptionDeletion({
        contaId: user.contaId,
        subscriptionId: academicSubscription.id,
        billingAgreementId: academicSubscription.billingAgreementId,
        externalReference: academicSubscription.externalReference,
        now,
      });
    } else {
      await convergeStandaloneSubscriptionDeletion({
        contaId: user.contaId,
        subscriptionId: standaloneSubscription!.id,
        billingAgreementId: standaloneSubscription!.billingAgreementId,
        externalReference: standaloneSubscription!.externalReference,
        now,
      });
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Assinatura excluída com sucesso.',
        data: { id: deleted?.id ?? subscription.asaasSubscriptionId, deleted: true },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof KycNotApprovedError) {
      return err(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }

    console.error('[API Subscription Delete] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}
