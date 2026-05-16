import { prisma } from '@alusa/database';
import type { AuditActorType } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { createAsaasAccount } from '../use-cases/asaas-account/create-asaas-account';
import { repairWebhookConfigDrift } from '../webhooks/webhook-config-drift.service';

const PROVISION_JOB_TYPE = 'PROVISION_SUBACCOUNT' as const;
const WEBHOOK_JOB_TYPE = 'CONFIGURE_WEBHOOK' as const;
const RECOVERY_REQUIRED_PREFIX = 'RECOVERY_REQUIRED:';

export type ProvisioningEnqueueResult = {
  financeProfileId: string;
  queued: boolean;
  status: 'CONNECTED' | 'QUEUED' | 'RECOVERY_REQUIRED';
  asaasAccountId: string | null;
};

export type ProvisioningJobResult = {
  processed: number;
  succeeded: number;
  failed: number;
  recoveryRequired: number;
  webhookJobsQueued: number;
  errors: Array<{ jobId: string; contaId: string; error: string }>;
};

function provisionIdempotencyKey(financeProfileId: string): string {
  return `financeProfile:${financeProfileId}:provision-subaccount:v1`;
}

function webhookIdempotencyKey(financeProfileId: string): string {
  return `financeProfile:${financeProfileId}:configure-webhook:v1`;
}

function nextRetryDate(attempts: number): Date {
  const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(attempts, 6)));
  return new Date(Date.now() + delayMinutes * 60 * 1000);
}

function toActor(value: unknown): { type: AuditActorType; id?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const type = (value as { type?: unknown }).type;
  if (type !== 'USER' && type !== 'ADMIN' && type !== 'SYSTEM') return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id ? { type, id } : { type };
}

export async function enqueueAsaasSubaccountProvisioning(params: {
  contaId: string;
  actor?: { type: AuditActorType; id?: string };
}): Promise<ProvisioningEnqueueResult> {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId: params.contaId },
    select: {
      id: true,
      asaasAccount: {
        select: {
          asaasAccountId: true,
          status: true,
          apiKeyEncrypted: true,
          apiKeyStatus: true,
          provisionLastError: true,
        },
      },
    },
  });

  if (!profile) throw new Error('FinanceProfile não encontrado');

  const account = profile.asaasAccount;
  if (
    account?.asaasAccountId &&
    account.apiKeyEncrypted &&
    account.apiKeyStatus === 'CONNECTED' &&
    ['CREATED', 'UNDER_REVIEW', 'APPROVED'].includes(account.status)
  ) {
    return {
      financeProfileId: profile.id,
      queued: false,
      status: 'CONNECTED',
      asaasAccountId: account.asaasAccountId,
    };
  }

  if (account?.provisionLastError?.startsWith(RECOVERY_REQUIRED_PREFIX)) {
    return {
      financeProfileId: profile.id,
      queued: false,
      status: 'RECOVERY_REQUIRED',
      asaasAccountId: account.asaasAccountId,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.asaasAccount.upsert({
      where: { financeProfileId: profile.id },
      create: {
        financeProfileId: profile.id,
        status: 'READY_FOR_PROVISIONING',
        statusUpdatedAt: new Date(),
        apiKeyStatus: 'MISSING',
      },
      update: {
        status: 'READY_FOR_PROVISIONING',
        statusUpdatedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.asaasIntegrationJob.upsert({
      where: {
        uq_asaas_integration_job: {
          contaId: params.contaId,
          type: PROVISION_JOB_TYPE,
          idempotencyKey: provisionIdempotencyKey(profile.id),
        },
      },
      create: {
        contaId: params.contaId,
        type: PROVISION_JOB_TYPE,
        status: 'PENDING',
        idempotencyKey: provisionIdempotencyKey(profile.id),
        payload: {
          financeProfileId: profile.id,
          actor: params.actor ?? { type: 'SYSTEM' },
        },
      },
      update: {
        status: 'PENDING',
        nextAttemptAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        doneAt: null,
        payload: {
          financeProfileId: profile.id,
          actor: params.actor ?? { type: 'SYSTEM' },
        },
      },
      select: { id: true },
    });
  });

  await auditLogService.record({
    contaId: params.contaId,
    action: 'finance.onboarding.provision_subaccount_queued',
    entity: { type: 'FinanceProfile', id: profile.id },
    metadata: { idempotencyKey: provisionIdempotencyKey(profile.id) },
    actor: params.actor,
  });

  return {
    financeProfileId: profile.id,
    queued: true,
    status: 'QUEUED',
    asaasAccountId: account?.asaasAccountId ?? null,
  };
}

async function enqueueWebhookConfigurationJob(contaId: string, financeProfileId: string) {
  await prisma.asaasIntegrationJob.upsert({
    where: {
      uq_asaas_integration_job: {
        contaId,
        type: WEBHOOK_JOB_TYPE,
        idempotencyKey: webhookIdempotencyKey(financeProfileId),
      },
    },
    create: {
      contaId,
      type: WEBHOOK_JOB_TYPE,
      status: 'PENDING',
      idempotencyKey: webhookIdempotencyKey(financeProfileId),
      payload: { financeProfileId },
    },
    update: {
      status: 'PENDING',
      nextAttemptAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      doneAt: null,
    },
    select: { id: true },
  });
}

async function failJob(jobId: string, attempts: number, error: string, recoveryRequired = false) {
  await prisma.asaasIntegrationJob.update({
    where: { id: jobId },
    data: {
      status: 'FAILED',
      attempts,
      lastError: error.slice(0, 1000),
      lastErrorAt: new Date(),
      processingAt: null,
      nextAttemptAt: recoveryRequired ? new Date(Date.now() + 24 * 60 * 60 * 1000) : nextRetryDate(attempts),
    },
    select: { id: true },
  });
}

export async function processAsaasProvisioningJobs(params?: {
  contaId?: string;
  limit?: number;
}): Promise<ProvisioningJobResult> {
  const limit = Math.max(1, Math.min(params?.limit ?? 10, 50));
  const jobs = await prisma.asaasIntegrationJob.findMany({
    where: {
      type: { in: [PROVISION_JOB_TYPE, WEBHOOK_JOB_TYPE] },
      status: { in: ['PENDING', 'FAILED'] },
      nextAttemptAt: { lte: new Date() },
      ...(params?.contaId ? { contaId: params.contaId } : {}),
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });

  const result: ProvisioningJobResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    recoveryRequired: 0,
    webhookJobsQueued: 0,
    errors: [],
  };

  for (const job of jobs) {
    const claimed = await prisma.asaasIntegrationJob.updateMany({
      where: { id: job.id, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'PROCESSING', processingAt: new Date() },
    });
    if (claimed.count !== 1) continue;

    result.processed++;
    const attempts = job.attempts + 1;

    try {
      if (job.type === PROVISION_JOB_TYPE) {
        const payload = job.payload as { actor?: unknown; financeProfileId?: string } | null;
        const createResult = await createAsaasAccount({
          contaId: job.contaId,
          actor: toActor(payload?.actor) ?? { type: 'SYSTEM' },
        });

        if (createResult.requiresManualApiKeyRecovery) {
          result.recoveryRequired++;
          await failJob(job.id, attempts, RECOVERY_REQUIRED_PREFIX);
          continue;
        }
        if (!createResult.asaasAccountId) {
          throw new Error('Provisionamento nao retornou asaasAccountId.');
        }

        await enqueueWebhookConfigurationJob(job.contaId, createResult.financeProfileId);
        result.webhookJobsQueued++;
      } else {
        const repair = await repairWebhookConfigDrift({
          contaId: job.contaId,
          actor: { type: 'SYSTEM' },
        });
        if (repair.reason === 'CREDENTIALS_MISSING') {
          throw new Error(`Webhook nao configurado: ${repair.failureCategory ?? repair.reason}`);
        }
      }

      await prisma.asaasIntegrationJob.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          attempts,
          doneAt: new Date(),
          processingAt: null,
          lastError: null,
          lastErrorAt: null,
        },
        select: { id: true },
      });
      result.succeeded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed++;
      result.errors.push({ jobId: job.id, contaId: job.contaId, error: message });
      await failJob(job.id, attempts, message);
    }
  }

  return result;
}
