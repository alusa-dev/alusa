import { prisma } from '@alusa/database';
import { isValidCpfCnpjDigits } from '@alusa/lib/cpf-cnpj';
import type { CustomerPayerType, Prisma } from '@prisma/client';
import { advisoryLockKey64 } from '../foundation/advisory-lock.server';

export class CustomerIdentityConflictError extends Error {
  constructor() {
    super('ASAAS_CUSTOMER_EM_USO_POR_OUTRO_PAGADOR');
    this.name = 'CustomerIdentityConflictError';
  }
}

export type CustomerIdentityInput = {
  contaId: string;
  payerType: CustomerPayerType;
  payerId: string;
  asaasCustomerId: string;
  /** Must match the CPF verified on the remote customer before linking. */
  cpfCnpj: string;
  externalReference?: string;
};

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

async function readPayer(db: Prisma.TransactionClient, contaId: string, payerType: CustomerPayerType, payerId: string) {
  const where = { contaId, id: payerId };
  const select = { id: true, cpf: true, asaasCustomerId: true, asaasCustomerExternalReference: true };
  return payerType === 'ALUNO'
    ? db.aluno.findFirst({ where, select })
    : db.responsavel.findFirst({ where, select });
}

/** A payer role is a link to a financial identity, never ownership of that identity. */
export async function findCustomerForPayer(contaId: string, payerType: CustomerPayerType, payerId: string) {
  // The runtime client always exposes CustomerPayer after the migration. The
  // guard keeps isolated legacy mocks/readers compatible during rollout.
  const link = prisma.customerPayer
    ? await prisma.customerPayer.findUnique({
        where: { contaId_payerType_payerId: { contaId, payerType, payerId } },
        include: { customer: true },
      })
    : null;
  if (link) return link.customer;
  return prisma.customer.findUnique({
    where: { contaId_payerType_payerId: { contaId, payerType, payerId } },
  });
}

/** No remote I/O inside this transaction. Existing financial records are never deleted or moved. */
export async function linkCustomerIdentity(input: CustomerIdentityInput) {
  const { contaId, payerType, payerId, asaasCustomerId } = input;
  const cpf = digits(input.cpfCnpj);
  if (!isValidCpfCnpjDigits(cpf) || !asaasCustomerId) throw new CustomerIdentityConflictError();
  return prisma.$transaction(async (tx) => {
    // Serialize both competing roles for the same remote identity and changes to a single payer.
    for (const key of [`customer-identity:${contaId}:${asaasCustomerId}`, `customer-payer:${contaId}:${payerType}:${payerId}`].sort()) {
      const lock = advisoryLockKey64(key);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lock}::bigint)`;
    }
    const payer = await readPayer(tx, contaId, payerType, payerId);
    if (!payer || digits(payer.cpf) !== cpf || (payer.asaasCustomerId && payer.asaasCustomerId !== asaasCustomerId)) {
      throw new CustomerIdentityConflictError();
    }
    const linked = await tx.customerPayer.findUnique({
      where: { contaId_payerType_payerId: { contaId, payerType, payerId } },
      include: { customer: true },
    });
    const legacy = await tx.customer.findUnique({
      where: { contaId_payerType_payerId: { contaId, payerType, payerId } },
    });
    const prior = linked?.customer ?? legacy;
    let canonical = await tx.customer.findFirst({ where: { contaId, asaasCustomerId } });
    if (canonical) {
      const owner = await readPayer(tx, contaId, canonical.payerType, canonical.payerId);
      if (!owner || digits(owner.cpf) !== cpf) throw new CustomerIdentityConflictError();
      // Keep the legacy owner represented in the additive link table as well. This
      // covers customers created after the backfill migration and makes the relation
      // complete before adding the second educational role.
      await tx.customerPayer.upsert({
        where: {
          contaId_payerType_payerId: {
            contaId,
            payerType: canonical.payerType,
            payerId: canonical.payerId,
          },
        },
        create: {
          contaId,
          customerId: canonical.id,
          payerType: canonical.payerType,
          payerId: canonical.payerId,
        },
        update: { customerId: canonical.id },
      });
      // A changed CPF on any previously linked role must not silently contaminate a shared identity.
      const roles = await tx.customerPayer.findMany({ where: { contaId, customerId: canonical.id } });
      for (const role of roles) {
        const person = await readPayer(tx, contaId, role.payerType, role.payerId);
        if (!person || digits(person.cpf) !== cpf) throw new CustomerIdentityConflictError();
      }
    }
    if (prior && canonical?.id !== prior.id) {
      if (prior.asaasCustomerId && prior.asaasCustomerId !== asaasCustomerId) throw new CustomerIdentityConflictError();
      // Keep the previous Customer row and all of its financial history intact.
      // Only the role link is pointed at the already verified canonical identity.
    }
    if (!canonical) {
      canonical = prior
        ? await tx.customer.update({ where: { uq_customer_conta_id: { contaId, id: prior.id } }, data: { asaasCustomerId } })
        : await tx.customer.create({ data: { contaId, payerType, payerId, asaasCustomerId, externalReference: input.externalReference ?? `customer:${contaId}:${payerType}:${payerId}` } });
    }
    await tx.customerPayer.upsert({
      where: { contaId_payerType_payerId: { contaId, payerType, payerId } },
      create: { contaId, payerType, payerId, customerId: canonical.id },
      update: { customerId: canonical.id },
    });
    const data = {
      asaasCustomerId,
      asaasCustomerExternalReference: canonical.externalReference,
    };
    // Avoid touching the payer row when the identity is already synchronized.
    // Prisma's @updatedAt would otherwise advance the row version during the
    // enrollment commit and create unnecessary cache/audit churn.
    if (
      payer.asaasCustomerId !== data.asaasCustomerId ||
      payer.asaasCustomerExternalReference !== data.asaasCustomerExternalReference
    ) {
      if (payerType === 'ALUNO') await tx.aluno.updateMany({ where: { contaId, id: payerId }, data });
      else await tx.responsavel.updateMany({ where: { contaId, id: payerId }, data });
    }
    return { id: canonical.id, asaasCustomerId, externalReference: canonical.externalReference };
  });
}
