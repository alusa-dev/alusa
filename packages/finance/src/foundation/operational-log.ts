import { createStructuredLog, sharedTelemetry } from '@alusa/observability';

export type FinanceOperationalEventName =
  | 'finance.webhook.installment.asaas_lookup.failed'
  | 'finance.webhook.installment.payments_lookup.failed'
  | 'finance.webhook.installment.realtime_publish.failed'
  | 'finance.webhook.installment.processing.failed'
  | 'finance.webhook.subscription.realtime_publish.failed'
  | 'finance.webhook.subscription.standalone_realtime_publish.failed'
  | 'finance.webhook.subscription.processing.failed'
  | 'finance.webhook.subscription.external_resource_observed'
  | 'finance.webhook.subscription.resource_origin_unknown'
  | 'finance.webhook.subscription.local_entity_missing'
  | 'finance.webhook.invoice.realtime_publish.failed'
  | 'finance.webhook.invoice.state_regression_blocked'
  | 'finance.webhook.invoice.conflict_reconciliation.failed'
  | 'finance.webhook.transfer.official_fetch.failed'
  | 'finance.webhook.transfer.failed'
  | 'finance.webhook.transfer.state_regression_blocked'
  | 'finance.webhook.transfer.notification.failed'
  | 'finance.webhook.transfer.processing.failed'
  | 'finance.webhook.internal_transfer.processing.failed'
  | 'finance.webhook.outbox.enqueue.failed'
  | 'finance.webhook.outbox.recovery.failed'
  | 'finance.webhook.replay.notification.failed'
  | 'finance.webhook.outbox.legacy_events.exhausted'
  | 'finance.webhook.outbox.effect.exhausted'
  | 'finance.webhook.config.repair.failed'
  | 'finance.webhook.rate_limit.redis_fallback'
  | 'finance.webhook.configuration.duplicate_removal.failed'
  | 'finance.webhook.dlq.requeued'
  | 'finance.webhook.notification.failed'
  | 'finance.webhook.dlq.materialize.failed'
  | 'finance.webhook.payment_resolver.legacy_subscription_fallback'
  | 'finance.webhook.scheduler.completed'
  | 'finance.customer.asaas_customer_service.failed'
  | 'finance.family_billing.processor.degraded'
  | 'finance.guards.charge_status_guard.degraded'
  | 'finance.guards.finance_status_guard.failed'
  | 'finance.jobs.apply_matricula_timeout.completed'
  | 'finance.jobs.cleanup_orphan_charges.completed'
  | 'finance.jobs.reconcile_asaas_accounts.completed'
  | 'finance.jobs.reconcile_asaas_accounts.degraded'
  | 'finance.jobs.reconcile_finance_webhooks_job.completed'
  | 'finance.jobs.reconcile_finance_webhooks_job.degraded'
  | 'finance.services.asaas_notification_preferences_service.failed'
  | 'finance.services.asaas_notification_sync_outbox_service.failed'
  | 'finance.services.asaas_sync_service.failed'
  | 'finance.services.customer_notification_bridge.degraded'
  | 'finance.services.customer_notification_service.degraded'
  | 'finance.services.customer_notification_service.failed'
  | 'finance.use_cases.admin.delete_asaas_account.degraded'
  | 'finance.use_cases.admin.delete_asaas_account.failed'
  | 'finance.use_cases.aluno_asaas_lifecycle.failed'
  | 'finance.use_cases.anticipations.degraded'
  | 'finance.use_cases.asaas_account.create_asaas_account.degraded'
  | 'finance.use_cases.asaas_account.create_asaas_account.failed'
  | 'finance.use_cases.asaas_account.reconcile_asaas_account.degraded'
  | 'finance.use_cases.asaas_account.update_asaas_account.degraded'
  | 'finance.use_cases.authorize_charge_invoice.failed'
  | 'finance.use_cases.cancel_charge_invoice.degraded'
  | 'finance.use_cases.cancel_charge_invoice.failed'
  | 'finance.use_cases.cancel_transfer.degraded'
  | 'finance.use_cases.cancel_transfer.failed'
  | 'finance.use_cases.changepayer.failed'
  | 'finance.use_cases.create_charge.failed'
  | 'finance.use_cases.create_customer.degraded'
  | 'finance.use_cases.create_installment_plan.failed'
  | 'finance.use_cases.create_payment.degraded'
  | 'finance.use_cases.create_standalone_charge.degraded'
  | 'finance.use_cases.create_standalone_charge.failed'
  | 'finance.use_cases.create_standalone_installment_plan.failed'
  | 'finance.use_cases.create_subscription.degraded'
  | 'finance.use_cases.create_subscription.failed'
  | 'finance.use_cases.ensure_asaas_customer_for_payer.degraded'
  | 'finance.use_cases.ensure_asaas_customer_for_payer.failed'
  | 'finance.use_cases.ensure_charge_invoice_auto_cancel.degraded'
  | 'finance.use_cases.ensure_charge_invoice_auto_cancel.failed'
  | 'finance.use_cases.ensure_customer.degraded'
  | 'finance.use_cases.ensure_customer.failed'
  | 'finance.use_cases.external_asaas.connect_external_asaas_account.degraded'
  | 'finance.use_cases.financial_read_convergence.degraded'
  | 'finance.use_cases.get_charge_invoice_detail.failed'
  | 'finance.use_cases.get_extrato.degraded'
  | 'finance.use_cases.get_fiscal_invoice_settings.failed'
  | 'finance.use_cases.get_onboarding_status.degraded'
  | 'finance.use_cases.get_transfer_detail.degraded'
  | 'finance.use_cases.kyc.get_account_verification_status.degraded'
  | 'finance.use_cases.kyc.kyc_reconciliation_service.degraded'
  | 'finance.use_cases.list_charges_aggregated.degraded'
  | 'finance.use_cases.list_standalone_charges.degraded'
  | 'finance.use_cases.manage_fiscal_services.failed'
  | 'finance.use_cases.mark_charge_as_paid.failed'
  | 'finance.use_cases.onboarding.wizard_service.degraded'
  | 'finance.use_cases.reconcile_academic_charges.degraded'
  | 'finance.use_cases.reconcile_pending_payment_commands.degraded'
  | 'finance.use_cases.request_withdraw.degraded'
  | 'finance.use_cases.request_withdraw.failed'
  | 'finance.use_cases.save_fiscal_core_settings.failed'
  | 'finance.use_cases.save_fiscal_invoice_settings.failed'
  | 'finance.use_cases.schedule_charge_invoice.degraded'
  | 'finance.use_cases.schedule_charge_invoice.failed'
  | 'finance.use_cases.store_inventory.failed'
  | 'finance.use_cases.store_sales.failed'
  | 'finance.use_cases.sync_invoice_from_provider.failed'
  | 'finance.use_cases.sync_payment_state_from_asaas.degraded'
  | 'finance.use_cases.sync_subscription_fiscal_settings.failed'
  | 'finance.use_cases.transfers.reconcile_open_transfers.degraded'
  | 'finance.use_cases.transfers.reconcile_open_transfers.state_regression_blocked'
  | 'finance.events.public_event_map.checkout.pix_qr.failed'
  | 'finance.events.public_event_map.checkout.bank_slip.failed'
  | 'finance.events.public_event_map.checkout.payment_reconciliation.failed'
  | 'finance.events.public_event_map.checkout.late_payment_cancel.failed'
  | 'finance.events.public_event_map.payment_instruments.pix_qr.failed'
  | 'finance.events.public_event_map.payment_instruments.bank_slip.failed'
  | 'finance.events.public_event_map.order_payment.reconcile.failed'
  | 'finance.events.public_event_map.reservation_expire.job.completed'
  | 'finance.events.public_event_map.order_reconcile.job.completed'
  | 'finance.events.public_event_map.ticket_fulfillment.job.completed'
  | 'finance.events.public_event_map.financial_inconsistencies.inspect'
  | 'finance.http.charge_detail.cache_write.failed'
  | 'finance.http.charge_detail.asaas_read.failed'
  | 'finance.http.charge_detail.asaas_unavailable'
  | 'finance.http.charge_delete.reconciliation.degraded'
  | 'finance.services.undo_cash_payment.reconciliation.failed'
  | 'finance.services.undo_cash_payment.failed'
  | 'finance.services.refund_charge.reconciliation.failed'
  | 'finance.services.refund_charge.failed'
  | 'finance.services.charge_cancellation.asaas_cancel.failed'
  | 'finance.services.charge_cancellation.state_sync.failed'
  | 'finance.services.charge_payment_method.asaas_configuration.failed'
  | 'finance.services.charge_payment_method.update.failed'
  | 'finance.services.person_payment_ledger.unmapped'
  | 'finance.adapters.create_asaas_payments_provider.audit_log.failed'
  | 'finance.foundation.advisory_lock.busy'
  | 'finance.foundation.advisory_lock.failed'
  | 'finance.foundation.advisory_lock.legacy_api.disabled'
  | 'finance.foundation.webhook_job_lock.lease_lost'
  | 'finance.foundation.webhook_job_lock.heartbeat.failed'
  | 'finance.foundation.webhook_job_lock.release.failed'
  | 'finance.foundation.env_validation.invalid'
  | 'finance.foundation.env_validation.warning'
  | 'finance.workers.webhook_worker.drain.failed'
  | 'finance.workers.webhook_worker.scheduler.failed'
  | 'finance.workers.webhook_worker.cycle.completed'
  | 'finance.workers.webhook_worker.already_running'
  | 'finance.workers.webhook_worker.fatal'
  | 'finance.read_model.charge.backfill.completed'
  | 'finance.mappers.charge_status.asaas.unknown';

const lastThrottledLogAt = new Map<FinanceOperationalEventName, number>();

function errorType(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : 'Error';
}

/** Emits a stable finance event without copying exception messages or domain identifiers. */
export function logFinanceOperationalEvent(params: {
  severity: 'info' | 'warn' | 'error';
  eventName: FinanceOperationalEventName;
  error?: unknown;
  itemCount?: number;
  errorCount?: number;
  skippedCount?: number;
  durationMs?: number;
  result?: 'success' | 'partial_failure';
  throttleMs?: number;
}): void {
  if (params.throttleMs && params.throttleMs > 0) {
    const now = Date.now();
    const lastLoggedAt = lastThrottledLogAt.get(params.eventName) ?? 0;
    if (now - lastLoggedAt < params.throttleMs) return;
    lastThrottledLogAt.set(params.eventName, now);
  }

  const log = createStructuredLog({
    severity: params.severity,
    'service.name': 'alusa-finance',
    'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    'event.name': params.eventName,
    'error.type': errorType(params.error),
    duration_ms:
      Number.isFinite(params.durationMs) && (params.durationMs ?? -1) >= 0
        ? params.durationMs
        : undefined,
    attributes: {
      ...(Number.isFinite(params.itemCount) && (params.itemCount ?? -1) >= 0
        ? { itemCount: params.itemCount }
        : {}),
      ...(Number.isFinite(params.errorCount) && (params.errorCount ?? -1) >= 0
        ? { errorCount: params.errorCount }
        : {}),
      ...(Number.isFinite(params.skippedCount) && (params.skippedCount ?? -1) >= 0
        ? { skippedCount: params.skippedCount }
        : {}),
      ...(params.result ? { result: params.result } : {}),
    },
    allowedAttributes: ['itemCount', 'errorCount', 'skippedCount', 'result'],
  });

  if (params.severity === 'error') console.error(JSON.stringify(log));
  else if (params.severity === 'warn') console.warn(JSON.stringify(log));
  else console.info(JSON.stringify(log));
  void sharedTelemetry.publishLog(log);
}
