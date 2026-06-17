import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import { isInvoiceProviderSyncPending } from '../mappers/invoice-status.mapper';
import { evaluateChargeInvoiceEligibility } from '../fiscal/charge-invoice-eligibility';
import { authorizeChargeInvoice } from './authorize-charge-invoice';
import {
  getChargeInvoiceDetail,
  type ChargeInvoiceDetailOutput,
} from './get-charge-invoice-detail';
import {
  scheduleChargeInvoice,
  type ScheduleChargeInvoiceInput,
} from './schedule-charge-invoice';
import { syncInvoiceFromProvider } from './sync-invoice-from-provider';

export type EmitChargeInvoiceInput = ScheduleChargeInvoiceInput;

export type EmitChargeInvoiceOutput = ChargeInvoiceDetailOutput & {
  /** A nota ainda está em processamento no Asaas/prefeitura — UI deve continuar polling. */
  syncPending: boolean;
};

export type EmitChargeInvoiceError = Awaited<
  ReturnType<typeof scheduleChargeInvoice>
> extends Result<unknown, infer E>
  ? E
  : never;

function resolveRouteRef(input: EmitChargeInvoiceInput): string {
  return input.chargeId;
}

function isSyncPending(detail: ChargeInvoiceDetailOutput): boolean {
  const invoice = detail.invoice;
  return isInvoiceProviderSyncPending({
    status: invoice?.status,
    hasProviderInvoice: invoice?.hasProviderInvoice,
    effectiveDate: invoice?.effectiveDate,
    minEffectiveDate: detail.preview?.minEffectiveDate,
  });
}

function fallbackPendingDetail(): EmitChargeInvoiceOutput {
  return {
    invoice: null,
    readiness: { ready: false, issues: [] },
    municipalOptions: { supportsCancellation: null },
    eligibility: evaluateChargeInvoiceEligibility({}),
    syncPending: true,
  };
}

export async function emitChargeInvoice(
  input: EmitChargeInvoiceInput,
): Promise<Result<EmitChargeInvoiceOutput, EmitChargeInvoiceError>> {
  const scheduled = await scheduleChargeInvoice(input);
  if (!scheduled.success) return err(scheduled.error);

  const routeRef = resolveRouteRef(input);

  await syncInvoiceFromProvider({
    contaId: input.contaId,
    chargeId: input.chargeId,
  });

  let detail = await getChargeInvoiceDetail({ contaId: input.contaId, routeRef });
  if (!detail.success) {
    return ok(fallbackPendingDetail());
  }

  if (
    detail.data.invoice?.status === 'SCHEDULED' &&
    detail.data.invoice.hasProviderInvoice &&
    isSyncPending(detail.data)
  ) {
    const authorized = await authorizeChargeInvoice({
      contaId: input.contaId,
      chargeId: input.chargeId,
      actor: input.actor,
    });

    if (!authorized.success) {
      const failure = authorized.error;
      const isAlreadyProcessing =
        typeof failure === 'object' &&
        failure !== null &&
        'status' in failure &&
        failure.status === 409;

      if (!isAlreadyProcessing) {
        return err(failure as EmitChargeInvoiceError);
      }
    }

    await syncInvoiceFromProvider({
      contaId: input.contaId,
      chargeId: input.chargeId,
    });

    detail = await getChargeInvoiceDetail({ contaId: input.contaId, routeRef });
    if (!detail.success) {
      return ok(fallbackPendingDetail());
    }
  }

  return ok({
    ...detail.data,
    syncPending: isSyncPending(detail.data),
  });
}
