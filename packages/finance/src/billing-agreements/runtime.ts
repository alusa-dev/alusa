import { prisma } from '@alusa/database';
import { randomUUID } from 'node:crypto';

import { auditLogService } from '../foundation/audit-log.service';
import { createAsaasBillingAgreementPort } from './asaas-subscription.adapter';
import { createPrismaBillingAgreementRepository } from './prisma.repository';
import { createBillingAgreementLifecycleService } from './service';
import { withBillingAgreementMutationLease } from './mutation-lease';
import type {
  BillingAgreementChangeInput,
  CommitBillingAgreementChangeInput,
} from './types';
import type { BillingOwnershipGuard } from './ports';

const repository = createPrismaBillingAgreementRepository(prisma);

const persistenceBackedLock = {
  async withAgreementLocks<T>(input: {
    contaId: string;
    agreementIds: string[];
    leaseToken?: string;
    run: (assertOwned: () => Promise<void>) => Promise<T>;
  }) {
    if (input.leaseToken) {
      const assertOwned = async () => {
        const active = await prisma.billingAgreement.count({
          where: {
            contaId: input.contaId,
            id: { in: input.agreementIds },
            mutationLeaseToken: input.leaseToken,
            mutationLeaseExpiresAt: { gt: new Date() },
          },
        });
        if (active !== new Set(input.agreementIds).size) {
          throw new Error('BILLING_AGREEMENT_MUTATION_LEASE_LOST');
        }
      };
      await assertOwned();
      return { acquired: true as const, result: await input.run(assertOwned) };
    }
    return withBillingAgreementMutationLease({
      db: prisma,
      contaId: input.contaId,
      agreementIds: input.agreementIds,
      leaseToken: `billing-change:${randomUUID()}`,
      run: input.run,
    });
  },
};

const lifecycle = createBillingAgreementLifecycleService({
  repository,
  asaas: createAsaasBillingAgreementPort(),
  lock: persistenceBackedLock,
  audit: {
    async record(input) {
      await auditLogService.record({
        contaId: input.contaId,
        action: input.action,
        entity: { type: 'BillingAgreement', id: input.entityIds[0] },
        actor: { type: 'USER', id: input.actorId },
        correlationId: input.correlationId,
        metadata: { ...input.metadata, entityIds: input.entityIds },
      });
    },
  },
});

export function previewBillingAgreementChange(input: BillingAgreementChangeInput) {
  return lifecycle.preview(input);
}

export function commitBillingAgreementChange(
  input: CommitBillingAgreementChangeInput,
  ownershipGuard?: BillingOwnershipGuard,
) {
  return lifecycle.commit(input, ownershipGuard);
}

export function getBillingAgreementView(input: { contaId: string; agreementId: string }) {
  return lifecycle.getAgreement(input);
}
