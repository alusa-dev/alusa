import { Prisma, type SubscriptionStatus } from '@prisma/client';

type StandaloneSubscriptionProjection = {
  id: string;
  asaasSubscriptionId: string | null;
  externalReference: string;
  status: SubscriptionStatus;
  description: string | null;
  billingType: string;
  customerId: string;
};

type StandaloneSubscriptionClient = {
  standaloneSubscription?: {
    findFirst: (args: any) => Promise<StandaloneSubscriptionProjection | null>;
    create: (args: any) => Promise<StandaloneSubscriptionProjection>;
  };
  $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T>;
};

type FindStandaloneSubscriptionParams = {
  contaId: string;
  externalReference?: string;
  idempotencyKey?: string;
  asaasSubscriptionId?: string;
  id?: string;
};

type CreateStandaloneSubscriptionParams = {
  id: string;
  contaId: string;
  customerId: string;
  externalReference: string;
  idempotencyKey: string;
  status: SubscriptionStatus;
  asaasSubscriptionId: string | null;
  cycle: string;
  billingType: string;
  value: number;
  nextDueDate: Date;
  endDate: Date | null;
  description?: string | null;
};

function getStandaloneSubscriptionDelegate(client: StandaloneSubscriptionClient) {
  return client.standaloneSubscription;
}

function joinWithOr(parts: Prisma.Sql[]): Prisma.Sql {
  if (parts.length === 0) return Prisma.sql`FALSE`;

  let query = parts[0];
  for (let index = 1; index < parts.length; index += 1) {
    query = Prisma.sql`${query} OR ${parts[index]}`;
  }
  return query;
}

export async function findStandaloneSubscription(
  client: StandaloneSubscriptionClient,
  params: FindStandaloneSubscriptionParams,
): Promise<StandaloneSubscriptionProjection | null> {
  const delegate = getStandaloneSubscriptionDelegate(client);
  const orConditions = [
    ...(params.id ? [{ id: params.id }] : []),
    ...(params.externalReference ? [{ externalReference: params.externalReference }] : []),
    ...(params.idempotencyKey ? [{ idempotencyKey: params.idempotencyKey }] : []),
    ...(params.asaasSubscriptionId ? [{ asaasSubscriptionId: params.asaasSubscriptionId }] : []),
  ];

  if (orConditions.length === 0) return null;

  if (delegate) {
    return delegate.findFirst({
      where: {
        contaId: params.contaId,
        OR: orConditions,
      },
      select: {
        id: true,
        asaasSubscriptionId: true,
        externalReference: true,
        status: true,
        description: true,
        billingType: true,
        customerId: true,
      },
    });
  }

  const rawConditions = joinWithOr([
    ...(params.id ? [Prisma.sql`id = ${params.id}`] : []),
    ...(params.externalReference ? [Prisma.sql`"externalReference" = ${params.externalReference}`] : []),
    ...(params.idempotencyKey ? [Prisma.sql`"idempotencyKey" = ${params.idempotencyKey}`] : []),
    ...(params.asaasSubscriptionId ? [Prisma.sql`"asaasSubscriptionId" = ${params.asaasSubscriptionId}`] : []),
  ]);

  const rows = await client.$queryRaw<Array<StandaloneSubscriptionProjection>>(Prisma.sql`
    SELECT
      id,
      "asaasSubscriptionId",
      "externalReference",
      status,
      description,
      "billingType",
      "customerId"
    FROM "StandaloneSubscription"
    WHERE "contaId" = ${params.contaId}
      AND (${rawConditions})
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);

  return rows[0] ?? null;
}

export async function createStandaloneSubscriptionRecord(
  client: StandaloneSubscriptionClient,
  params: CreateStandaloneSubscriptionParams,
): Promise<StandaloneSubscriptionProjection> {
  const delegate = getStandaloneSubscriptionDelegate(client);

  if (delegate) {
    return delegate.create({
      data: {
        id: params.id,
        contaId: params.contaId,
        customerId: params.customerId,
        externalReference: params.externalReference,
        idempotencyKey: params.idempotencyKey,
        status: params.status,
        statusUpdatedAt: new Date(),
        asaasSubscriptionId: params.asaasSubscriptionId,
        cycle: params.cycle,
        billingType: params.billingType,
        value: params.value,
        nextDueDate: params.nextDueDate,
        endDate: params.endDate,
        description: params.description,
      },
      select: {
        id: true,
        asaasSubscriptionId: true,
        externalReference: true,
        status: true,
        description: true,
        billingType: true,
        customerId: true,
      },
    });
  }

  const now = new Date();
  const rows = await client.$queryRaw<Array<StandaloneSubscriptionProjection>>(Prisma.sql`
    INSERT INTO "StandaloneSubscription" (
      id,
      "contaId",
      "customerId",
      "externalReference",
      "idempotencyKey",
      status,
      "statusUpdatedAt",
      "asaasSubscriptionId",
      cycle,
      "billingType",
      value,
      "nextDueDate",
      "endDate",
      description,
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${params.id},
      ${params.contaId},
      ${params.customerId},
      ${params.externalReference},
      ${params.idempotencyKey},
      ${params.status}::"SubscriptionStatus",
      ${now},
      ${params.asaasSubscriptionId},
      ${params.cycle},
      ${params.billingType},
      ${params.value},
      ${params.nextDueDate},
      ${params.endDate},
      ${params.description ?? null},
      ${now},
      ${now}
    )
    RETURNING
      id,
      "asaasSubscriptionId",
      "externalReference",
      status,
      description,
      "billingType",
      "customerId"
  `);

  if (!rows[0]) {
    throw new Error('STANDALONE_SUBSCRIPTION_INSERT_FAILED');
  }

  return rows[0];
}