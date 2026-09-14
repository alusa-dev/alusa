import {
  getInstallmentPlanDetail,
  listInstallmentPlansAggregated,
} from '@alusa/finance';

import { assertMobileBillingActor, MobileBillingUnauthorizedError } from './mobile-billing.service';

export type MobileInstallmentsActor = { userId: string; contaId: string };

export class MobileInstallmentsUnauthorizedError extends Error {
  constructor() {
    super('Usuário sem acesso à conta ativa.');
    this.name = 'MobileInstallmentsUnauthorizedError';
  }
}

async function assertActor(actor: MobileInstallmentsActor) {
  try {
    await assertMobileBillingActor(actor);
  } catch (error) {
    if (error instanceof MobileBillingUnauthorizedError) {
      throw new MobileInstallmentsUnauthorizedError();
    }
    throw error;
  }
}

export async function listMobileInstallments(input: {
  actor: MobileInstallmentsActor;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  await assertActor(input.actor);
  return listInstallmentPlansAggregated({
    contaId: input.actor.contaId,
    page: input.page,
    pageSize: input.pageSize,
    search: input.search?.trim() || undefined,
  });
}

export async function getMobileInstallmentDetail(actor: MobileInstallmentsActor, planId: string) {
  await assertActor(actor);
  return getInstallmentPlanDetail({ planId, contaId: actor.contaId });
}
