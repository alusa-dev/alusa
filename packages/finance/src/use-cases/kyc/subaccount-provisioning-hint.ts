import { prisma } from '@alusa/database';

const PROVISION_JOB_TYPE = 'PROVISION_SUBACCOUNT' as const;
const RECOVERY_REQUIRED_PREFIX = 'RECOVERY_REQUIRED:';

/**
 * Estado de provisionamento de subconta Asaas (white-label), para UI/API quando o snapshot KYC ainda não existe.
 */
export type SubaccountProvisioningHint = {
  state: 'QUEUED' | 'PROCESSING' | 'FAILED' | 'RECOVERY_REQUIRED';
  jobStatus?: string;
  asaasAccountStatus?: string | null;
  lastError?: string | null;
  attempts?: number;
};

export async function resolveSubaccountProvisioningHint(contaId: string): Promise<SubaccountProvisioningHint | null> {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: {
      asaasAccount: {
        select: {
          asaasAccountId: true,
          status: true,
          apiKeyStatus: true,
          provisionLastError: true,
        },
      },
    },
  });

  const acc = profile?.asaasAccount;
  const hasConnectedSubaccount =
    Boolean(acc?.asaasAccountId) && acc?.apiKeyStatus === 'CONNECTED';

  if (hasConnectedSubaccount) {
    return null;
  }

  const job = await prisma.asaasIntegrationJob.findFirst({
    where: { contaId, type: PROVISION_JOB_TYPE },
    orderBy: { updatedAt: 'desc' },
    select: {
      status: true,
      lastError: true,
      attempts: true,
    },
  });

  if (job) {
    if (job.status === 'PENDING') {
      return {
        state: 'QUEUED',
        jobStatus: job.status,
        asaasAccountStatus: acc?.status ?? null,
        lastError: job.lastError,
        attempts: job.attempts,
      };
    }
    if (job.status === 'PROCESSING') {
      return {
        state: 'PROCESSING',
        jobStatus: job.status,
        asaasAccountStatus: acc?.status ?? null,
        lastError: job.lastError,
        attempts: job.attempts,
      };
    }
    if (job.status === 'FAILED') {
      const recovery = job.lastError?.startsWith(RECOVERY_REQUIRED_PREFIX) ?? false;
      return {
        state: recovery ? 'RECOVERY_REQUIRED' : 'FAILED',
        jobStatus: job.status,
        asaasAccountStatus: acc?.status ?? null,
        lastError: job.lastError,
        attempts: job.attempts,
      };
    }
  }

  if (acc?.provisionLastError?.startsWith(RECOVERY_REQUIRED_PREFIX)) {
    return {
      state: 'RECOVERY_REQUIRED',
      asaasAccountStatus: acc.status,
      lastError: acc.provisionLastError,
    };
  }

  if (acc?.status === 'READY_FOR_PROVISIONING' && !acc.asaasAccountId) {
    return {
      state: job?.status === 'DONE' ? 'FAILED' : 'QUEUED',
      jobStatus: job?.status,
      asaasAccountStatus: acc.status,
      lastError: job?.lastError ?? null,
      attempts: job?.attempts,
    };
  }

  return null;
}
