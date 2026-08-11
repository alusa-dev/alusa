import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import {
  processFamilyBillingOutboxEvent,
  reconcileFailedFamilyEnrollmentOutbox,
} from '@alusa/finance/family-billing/processor';

type IdParams = Promise<{ id: string }> | { id: string };

function derivePaymentStatus(charges: Array<{ status: string; dueDate: Date | null }>) {
  if (charges.length === 0) return 'SEM_COBRANCA';
  if (charges.some((charge) => charge.status === 'OVERDUE')) return 'INADIMPLENTE';
  if (charges.every((charge) => charge.status === 'PAID')) return 'ADIMPLENTE';
  if (charges.some((charge) => charge.status === 'REFUNDED')) return 'ESTORNADO';
  if (charges.some((charge) => charge.status === 'PAID')) return 'PARCIALMENTE_PAGO';
  const now = new Date();
  return charges.every((charge) => charge.dueDate && charge.dueDate > now)
    ? 'A_VENCER'
    : 'PENDENTE';
}

export async function GET(_request: Request, context: { params: IdParams }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Usuário não autenticado.' } }, { status: 401 });
  }
  const { id } = await Promise.resolve(context.params);
  const family = await prisma.matriculaFamiliar.findFirst({
    where: { id, contaId: user.contaId },
    include: {
      items: {
        orderBy: { orderIndex: 'asc' },
        include: {
          matricula: {
            select: {
              id: true,
              status: true,
              taxaStatus: true,
              statusFinanceiro: true,
              billingProvisionStatus: true,
              aluno: { select: { id: true, nome: true } },
              contratoAtual: { select: { id: true, status: true } },
            },
          },
        },
      },
      enrollmentOperations: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, lastError: true, result: true, updatedAt: true },
      },
    },
  });
  if (!family) {
    return NextResponse.json({ error: { message: 'Matrícula familiar não encontrada.' } }, { status: 404 });
  }
  const operation = family.enrollmentOperations[0] ?? null;
  const operationAllocations = operation
    ? await prisma.familyFinancialAllocation.findMany({
        where: {
          contaId: user.contaId,
          familyGroupId: family.id,
          familyEnrollmentOperationId: operation.id,
        },
        select: { sourceChargeId: true },
      })
    : [];
  const operationChargeIds = Array.from(
    new Set(operationAllocations.flatMap((item) => (item.sourceChargeId ? [item.sourceChargeId] : []))),
  );
  const charges = await prisma.charge.findMany({
    where: { contaId: user.contaId, id: { in: operationChargeIds } },
    select: { id: true, status: true, dueDate: true },
  });
  const storedResult =
    operation?.result && typeof operation.result === 'object' && !Array.isArray(operation.result)
      ? (operation.result as Record<string, unknown>)
      : null;
  const storedItems = Array.isArray(storedResult?.results)
    ? (storedResult.results as Array<Record<string, unknown>>)
    : [];
  const liveItems = family.items.map((item) => ({
    alunoId: item.matricula.aluno.id,
    alunoNome: item.matricula.aluno.nome,
    status: 'success' as const,
    matriculaId: item.matricula.id,
    contratoId: item.matricula.contratoAtual?.id ?? undefined,
    academic: { status: item.matricula.status, matriculaId: item.matricula.id },
    contract: item.matricula.contratoAtual
      ? { status: item.matricula.contratoAtual.status, contratoId: item.matricula.contratoAtual.id }
      : { status: 'FAILED', contratoId: null },
    finance: {
      taxaStatus: item.matricula.taxaStatus,
      status: item.matricula.statusFinanceiro,
      provisionStatus: item.matricula.billingProvisionStatus,
    },
  }));
  const liveByStudent = new Map(liveItems.map((item) => [item.alunoId, item]));
  const results = [
    ...storedItems.map((item) => liveByStudent.get(String(item.alunoId)) ?? item),
    ...liveItems.filter(
      (item) => !storedItems.some((stored) => String(stored.alunoId) === item.alunoId),
    ),
  ];
  const operationInProgress =
    operation?.status === 'PENDING' || operation?.status === 'PROCESSING';

  return NextResponse.json(
    {
      familyId: family.id,
      academicStatus: family.academicStatus,
      billingProvisionStatus: operationInProgress
        ? 'PROCESSANDO'
        : family.billingProvisionStatus,
      paymentStatus:
        charges.length > 0
          ? derivePaymentStatus(charges)
          : family.billingProvisionStatus === 'PROVISIONADO'
            ? 'A_VENCER'
            : 'PENDENTE',
      financialError: family.ultimoErro
        ? 'O provisionamento financeiro requer atenção. Atualize o status ou acione o suporte.'
        : null,
      operationStatus: operation?.status,
      operation: operation
        ? { id: operation.id, status: operation.status, updatedAt: operation.updatedAt }
        : null,
      results,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Reprocessa com segurança a cobrança familiar pendente ou incerta.
 * O processador é idempotente e reconcilia primeiro os artefatos remotos.
 */
export async function POST(_request: Request, context: { params: IdParams }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: { message: 'Usuário não autenticado.' } }, { status: 401 });
  }

  const { id } = await Promise.resolve(context.params);
  const family = await prisma.matriculaFamiliar.findFirst({
    where: { id, contaId: user.contaId },
    select: {
      id: true,
      items: { select: { id: true } },
      enrollmentOperations: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true },
      },
    },
  });
  if (!family) {
    return NextResponse.json(
      { error: { message: 'Matrícula familiar não encontrada.' } },
      { status: 404 },
    );
  }

  const event = await prisma.familyBillingOutbox.findFirst({
    where: {
      contaId: user.contaId,
      matriculaFamiliarId: family.id,
      status: { in: ['PENDING', 'FAILED', 'REQUIRES_RECONCILIATION'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!event) {
    return NextResponse.json(
      { error: { message: 'Nenhum provisionamento financeiro pendente foi encontrado.' } },
      { status: 409 },
    );
  }

  try {
    const latestOperation = family.enrollmentOperations[0];
    if (latestOperation?.status === 'REQUIRES_RECONCILIATION' && family.items.length === 0) {
      const result = await reconcileFailedFamilyEnrollmentOutbox(event.id);
      return NextResponse.json(result, {
        status: result.processed ? 200 : 202,
        headers: { 'cache-control': 'no-store' },
      });
    }
    const result = await processFamilyBillingOutboxEvent(event.id, {
      allowReconciliation: true,
    });
    return NextResponse.json(result, {
      status: result.processed ? 200 : 202,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error('[POST /api/matriculas/familiar/:id/provisionamento]', error);
    return NextResponse.json(
      { error: { message: 'Não foi possível reconciliar o provisionamento financeiro.' } },
      { status: 422 },
    );
  }
}
