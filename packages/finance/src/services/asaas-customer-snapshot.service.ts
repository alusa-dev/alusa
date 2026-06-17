import { AsaasHttpError, getCustomer } from '@alusa/asaas';
import type { AsaasCustomer } from '@alusa/asaas';
import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';

type CustomerCandidate = {
  contaId: string;
  asaasCustomerId: string;
  localCustomerId?: string | null;
  payerType?: string | null;
  payerId?: string | null;
};

export type ReconcileAsaasCustomerSnapshotsInput = {
  contaId?: string;
  limit?: number;
  maxAccounts?: number;
};

export type ReconcileAsaasCustomerSnapshotsResult = {
  scanned: number;
  updated: number;
  deleted: number;
  missingCredentials: number;
  failed: number;
  errors: Array<{ contaId: string; asaasCustomerId: string; message: string }>;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isNotFound(error: unknown): boolean {
  return error instanceof AsaasHttpError && error.status === 404;
}

function mapRemoteCustomer(input: {
  contaId: string;
  candidate: CustomerCandidate;
  customer: AsaasCustomer;
  fetchedAt: Date;
}) {
  const { contaId, candidate, customer, fetchedAt } = input;
  return {
    contaId,
    asaasCustomerId: customer.id,
    localCustomerId: candidate.localCustomerId ?? null,
    payerType: candidate.payerType ?? null,
    payerId: candidate.payerId ?? null,
    name: customer.name ?? null,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    mobilePhone: customer.mobilePhone ?? null,
    cpfCnpj: customer.cpfCnpj ?? null,
    personType: customer.personType ?? null,
    externalReference: customer.externalReference ?? null,
    notificationDisabled: customer.notificationDisabled ?? null,
    deleted: customer.deleted ?? false,
    raw: asJson(customer),
    fetchedAt,
  };
}

export async function upsertAsaasCustomerSnapshot(input: {
  contaId: string;
  candidate: CustomerCandidate;
  customer: AsaasCustomer;
  fetchedAt?: Date;
}) {
  const fetchedAt = input.fetchedAt ?? new Date();
  const data = mapRemoteCustomer({
    contaId: input.contaId,
    candidate: input.candidate,
    customer: input.customer,
    fetchedAt,
  });

  return prisma.asaasCustomerSnapshot.upsert({
    where: {
      uq_asaas_customer_snapshot_conta_asaas: {
        contaId: input.contaId,
        asaasCustomerId: input.customer.id,
      },
    },
    update: data,
    create: data,
  });
}

async function markAsaasCustomerDeleted(input: {
  contaId: string;
  candidate: CustomerCandidate;
  fetchedAt: Date;
}) {
  const data = {
    contaId: input.contaId,
    asaasCustomerId: input.candidate.asaasCustomerId,
    localCustomerId: input.candidate.localCustomerId ?? null,
    payerType: input.candidate.payerType ?? null,
    payerId: input.candidate.payerId ?? null,
    deleted: true,
    fetchedAt: input.fetchedAt,
  };

  return prisma.asaasCustomerSnapshot.upsert({
    where: {
      uq_asaas_customer_snapshot_conta_asaas: {
        contaId: input.contaId,
        asaasCustomerId: input.candidate.asaasCustomerId,
      },
    },
    update: {
      localCustomerId: data.localCustomerId,
      payerType: data.payerType,
      payerId: data.payerId,
      deleted: true,
      fetchedAt: data.fetchedAt,
    },
    create: data,
  });
}

async function listContaIds(maxAccounts: number): Promise<string[]> {
  const [customers, alunos, responsaveis] = await Promise.all([
    prisma.customer.findMany({
      where: { asaasCustomerId: { not: null } },
      distinct: ['contaId'],
      orderBy: { updatedAt: 'asc' },
      take: maxAccounts,
      select: { contaId: true },
    }),
    prisma.aluno.findMany({
      where: { asaasCustomerId: { not: null } },
      distinct: ['contaId'],
      orderBy: { updatedAt: 'asc' },
      take: maxAccounts,
      select: { contaId: true },
    }),
    prisma.responsavel.findMany({
      where: { asaasCustomerId: { not: null } },
      distinct: ['contaId'],
      orderBy: { nome: 'asc' },
      take: maxAccounts,
      select: { contaId: true },
    }),
  ]);

  return Array.from(
    new Set([...customers, ...alunos, ...responsaveis].map((row) => row.contaId)),
  ).slice(0, maxAccounts);
}

async function listCandidates(contaId: string, limit: number): Promise<CustomerCandidate[]> {
  const [customers, alunos, responsaveis] = await Promise.all([
    prisma.customer.findMany({
      where: { contaId, asaasCustomerId: { not: null } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: {
        id: true,
        contaId: true,
        asaasCustomerId: true,
        payerType: true,
        payerId: true,
      },
    }),
    prisma.aluno.findMany({
      where: { contaId, asaasCustomerId: { not: null } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true, contaId: true, asaasCustomerId: true },
    }),
    prisma.responsavel.findMany({
      where: { contaId, asaasCustomerId: { not: null } },
      orderBy: { nome: 'asc' },
      take: limit,
      select: { id: true, contaId: true, asaasCustomerId: true },
    }),
  ]);

  const byAsaasId = new Map<string, CustomerCandidate>();

  for (const row of customers) {
    if (!row.asaasCustomerId) continue;
    byAsaasId.set(row.asaasCustomerId, {
      contaId: row.contaId,
      asaasCustomerId: row.asaasCustomerId,
      localCustomerId: row.id,
      payerType: row.payerType,
      payerId: row.payerId,
    });
  }

  for (const row of alunos) {
    if (!row.asaasCustomerId || byAsaasId.has(row.asaasCustomerId)) continue;
    byAsaasId.set(row.asaasCustomerId, {
      contaId: row.contaId,
      asaasCustomerId: row.asaasCustomerId,
      payerType: 'ALUNO',
      payerId: row.id,
    });
  }

  for (const row of responsaveis) {
    if (!row.asaasCustomerId || byAsaasId.has(row.asaasCustomerId)) continue;
    byAsaasId.set(row.asaasCustomerId, {
      contaId: row.contaId,
      asaasCustomerId: row.asaasCustomerId,
      payerType: 'RESPONSAVEL',
      payerId: row.id,
    });
  }

  return [...byAsaasId.values()].slice(0, limit);
}

export async function reconcileAsaasCustomerSnapshots(
  input: ReconcileAsaasCustomerSnapshotsInput = {},
): Promise<ReconcileAsaasCustomerSnapshotsResult> {
  const limit = clampInt(input.limit, 50, 1, 200);
  const maxAccounts = clampInt(input.maxAccounts, 20, 1, 100);
  const contaIds = input.contaId ? [input.contaId] : await listContaIds(maxAccounts);
  const result: ReconcileAsaasCustomerSnapshotsResult = {
    scanned: 0,
    updated: 0,
    deleted: 0,
    missingCredentials: 0,
    failed: 0,
    errors: [],
  };

  for (const contaId of contaIds) {
    const credentials = await loadAsaasCredentials(contaId);
    if (!credentials?.apiKey) {
      result.missingCredentials += 1;
      continue;
    }

    const candidates = await listCandidates(contaId, limit);
    for (const candidate of candidates) {
      result.scanned += 1;
      const fetchedAt = new Date();
      try {
        const customer = await getCustomer({
          apiKey: credentials.apiKey,
          customerId: candidate.asaasCustomerId,
        });
        await upsertAsaasCustomerSnapshot({ contaId, candidate, customer, fetchedAt });
        result.updated += 1;
      } catch (error) {
        if (isNotFound(error)) {
          await markAsaasCustomerDeleted({ contaId, candidate, fetchedAt });
          result.deleted += 1;
          continue;
        }

        result.failed += 1;
        result.errors.push({
          contaId,
          asaasCustomerId: candidate.asaasCustomerId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}
