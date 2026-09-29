import { getSubscription } from '@alusa/finance';
import { prisma } from '@/src/prisma';
import {
  previewInitialEnrollmentBilling,
  type InitialEnrollmentBillingPreviewInput,
} from './initial-enrollment-billing-preview.service';

export async function previewInitialEnrollmentBillingForTenant(input: InitialEnrollmentBillingPreviewInput) {
  return previewInitialEnrollmentBilling(input, {
    prisma,
    getRemoteSubscription: async ({ contaId, subscriptionId }) => {
      const subscription = await getSubscription(subscriptionId, { contaId });
      return { status: subscription.status, deleted: subscription.deleted };
    },
  });
}
