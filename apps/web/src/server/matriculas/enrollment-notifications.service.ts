import {
  channelPreferencesFromWizardSelection,
  recordNotificationSyncAudit,
  syncCustomerNotificationsForUserSelection,
  type SyncNotificationResult,
} from '@alusa/finance';
import { runWithTenant } from '@/lib/prisma-tenant';
import { resolveMatriculaFinancialContext } from './financial-context.service';

export type EnrollmentNotificationInput = {
  contaId: string;
  matriculaId: string;
  actorId: string;
  correlationId?: string;
  channels?: Array<'EMAIL' | 'SMS' | 'WHATSAPP'>;
  configured?: boolean;
};

const RETRY_MESSAGE =
  'A matrícula foi confirmada, mas os canais de aviso não foram aplicados integralmente. Abra as notificações da matrícula para tentar novamente, sem recriar a matrícula ou suas cobranças.';

/** Runs only after financial confirmation; notification failures cannot undo enrollment. */
export async function syncEnrollmentNotifications(
  input: EnrollmentNotificationInput,
): Promise<SyncNotificationResult | null> {
  // An untouched selection preserves the customer's existing settings. An explicit
  // empty selection is an opt-out and must reach the integration.
  if (!input.configured) return null;
  const channels = input.channels ?? [];
  let customerId: string | null = null;
  let enrollmentVerified = false;
  let result: SyncNotificationResult;
  try {
    const alreadyApplied = await runWithTenant(input.contaId, (tx) => tx.matriculaLog.findFirst({
      where: {
        matriculaId: input.matriculaId,
        matricula: { contaId: input.contaId },
        action: 'MATRICULA_NOTIFICATION_CHANNELS_SYNCED',
        metadata: { path: ['success'], equals: true },
      },
      select: { id: true },
    }));
    // Replaying creation must not overwrite preferences subsequently edited on
    // the customer's other enrollments. Explicit retries use the notification API.
    if (alreadyApplied) return null;
    const context = await runWithTenant(input.contaId, (tx) => resolveMatriculaFinancialContext({
      db: tx,
      contaId: input.contaId,
      matriculaId: input.matriculaId,
    }));
    enrollmentVerified = context !== null;
    customerId = context?.customerId ?? null;
    if (!customerId) throw new Error('Financial customer unavailable');
    result = await syncCustomerNotificationsForUserSelection(
      input.contaId,
      customerId,
      channelPreferencesFromWizardSelection(channels),
    );
    if (!result.success && result.warnings.length === 0) {
      result = { ...result, warnings: [retryWarning()] };
    }
  } catch {
    // Never include external errors or customer data in the HTTP response.
    result = {
      success: false,
      applied: { email: false, sms: false, whatsapp: false },
      warnings: [retryWarning()],
    };
  }

  try {
    if (customerId) {
      await recordNotificationSyncAudit({
        contaId: input.contaId,
        asaasCustomerId: customerId,
        channels,
        externalReference: input.matriculaId,
        correlationId: input.correlationId,
        status: !result.success ? 'FAILED' : result.warnings.length ? 'PARTIAL' : 'SUCCESS',
        warningsCount: result.warnings.length,
      });
    }
    if (!enrollmentVerified) return result;
    await runWithTenant(input.contaId, (tx) => tx.matriculaLog.create({
      data: {
        matriculaId: input.matriculaId,
        actorId: input.actorId,
        action: 'MATRICULA_NOTIFICATION_CHANNELS_SYNCED',
        metadata: {
          contaId: input.contaId,
          correlationId: input.correlationId ?? null,
          requestedChannels: channels,
          appliedChannels: {
            email: result.applied.email,
            sms: result.applied.sms,
            whatsapp: result.applied.whatsapp,
          },
          success: result.success,
          warningCodes: result.warnings.map((warning) => warning.code),
        },
      },
    }));
  } catch {
    console.warn('[enrollment-notifications] Audit persistence failed', {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      correlationId: input.correlationId,
    });
  }
  return result;
}

function retryWarning(): SyncNotificationResult['warnings'][number] {
  return {
    notificationId: '',
    event: 'ENROLLMENT_NOTIFICATION_SYNC',
    channel: 'email',
    code: 'ENROLLMENT_NOTIFICATION_SYNC_FAILED',
    message: RETRY_MESSAGE,
  };
}
