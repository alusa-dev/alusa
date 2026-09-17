import { prisma } from '@/lib/prisma';
import {
  createPrismaBillingIntegrityRepository,
  reconcileBillingAgreementIntegrity,
} from '@alusa/finance';

export function reconcileBillingAgreementsForTenant(input: {
  contaId: string;
  dryRun: boolean;
  actionIds?: string[];
}) {
  const repository = createPrismaBillingIntegrityRepository(prisma);
  return reconcileBillingAgreementIntegrity({
    contaId: input.contaId,
    repository,
    dryRun: input.dryRun,
    ...(input.actionIds ? { actionIds: input.actionIds } : {}),
  });
}
