import { prisma } from '@alusa/database';

import { auditLogService } from '../foundation/audit-log.service';
import { createAsaasBillingAgreementPort } from './asaas-subscription.adapter';
import { createPrismaBillingAgreementRepository } from './prisma.repository';
import { createBillingAgreementLifecycleService } from './service';
import type {
  BillingAgreementChangeInput,
  CommitBillingAgreementChangeInput,
} from './types';

const repository = createPrismaBillingAgreementRepository(prisma);

/**
 * A exclusão mútua distribuída é garantida por constraints parciais da
 * BillingChangeOperation e por versão otimista. Não mantemos transação ou
 * conexão Prisma aberta enquanto aguardamos a API do Asaas.
 */
const persistenceBackedLock = {
  async withAgreementLocks<T>(input: { run: () => Promise<T> }) {
    return { acquired: true as const, result: await input.run() };
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

export function commitBillingAgreementChange(input: CommitBillingAgreementChangeInput) {
  return lifecycle.commit(input);
}

export function getBillingAgreementView(input: { contaId: string; agreementId: string }) {
  return lifecycle.getAgreement(input);
}

