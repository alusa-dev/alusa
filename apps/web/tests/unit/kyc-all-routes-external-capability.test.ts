import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTenantSession: vi.fn(),
  asaasFunctions: {
    submitKycData: vi.fn(),
    getKycViewModel: vi.fn(),
    getKycViewModelFresh: vi.fn(),
    getWizardState: vi.fn(),
    completeWizard: vi.fn(),
    saveWizardStep1: vi.fn(),
    saveWizardStep2: vi.fn(),
    saveWizardStep3: vi.fn(),
    saveWizardStep4: vi.fn(),
    saveWizardStep5: vi.fn(),
    deleteKycDocumentFile: vi.fn(),
    viewKycDocumentFile: vi.fn(),
    financeProfileOnboardingDataSchema: { parse: vi.fn() },
    wizardStep1Schema: { parse: vi.fn() },
    wizardStep2Schema: { parse: vi.fn() },
    wizardStep3Schema: { parse: vi.fn() },
    wizardStep4Schema: { parse: vi.fn() },
    wizardStep5Schema: { parse: vi.fn() },
  },
  getKycSnapshotByContaId: vi.fn(),
  uploadKycDocumentByGroup: vi.fn(),
  updateKycDocumentFile: vi.fn(),
  readBoundedFormData: vi.fn(),
  rateLimitAsync: vi.fn(),
  withTenantUploadQuota: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: mocks.resolveTenantSession }));
vi.mock('@alusa/finance', () => ({
  ...mocks.asaasFunctions,
  AsaasHttpError: class extends Error {},
  AsaasSandboxSubaccountDailyLimitError: class extends Error {},
  MissingAsaasAccountIdError: class extends Error {},
  MissingAsaasApiKeyError: class extends Error {},
  MissingBirthDateError: class extends Error {},
  MissingCompanyTypeError: class extends Error {},
  deleteKycDocumentFile: mocks.asaasFunctions.deleteKycDocumentFile,
  viewKycDocumentFile: mocks.asaasFunctions.viewKycDocumentFile,
}));
vi.mock('@alusa/finance/use-cases/kyc/get-kyc-snapshot', () => ({
  getKycSnapshotByContaId: mocks.getKycSnapshotByContaId,
}));
vi.mock('@alusa/finance/use-cases/kyc/upload-kyc-document-by-group', () => ({
  uploadKycDocumentByGroup: mocks.uploadKycDocumentByGroup,
}));
vi.mock('@alusa/finance/use-cases/kyc/update-kyc-document-file', () => ({
  updateKycDocumentFile: mocks.updateKycDocumentFile,
}));
vi.mock('@/lib/upload-request', () => ({ readBoundedFormData: mocks.readBoundedFormData }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: () => '127.0.0.1',
  rateLimitAsync: mocks.rateLimitAsync,
}));
vi.mock('@/lib/upload-quota.server', () => ({ withTenantUploadQuota: mocks.withTenantUploadQuota }));

import { POST as onboardingPost } from '@/app/api/kyc/onboarding/route';
import { POST as refreshPost } from '@/app/api/kyc/refresh/route';
import { GET as kycGet } from '@/app/api/kyc/route';
import { GET as documentsGet } from '@/app/api/kyc/documents/route';
import { GET as wizardGet } from '@/app/api/kyc/wizard/route';
import { POST as wizardCompletePost } from '@/app/api/kyc/wizard/complete/route';
import { POST as step1Post } from '@/app/api/kyc/wizard/step1/route';
import { POST as step2Post } from '@/app/api/kyc/wizard/step2/route';
import { POST as step3Post } from '@/app/api/kyc/wizard/step3/route';
import { POST as step4Post } from '@/app/api/kyc/wizard/step4/route';
import { POST as step5Post } from '@/app/api/kyc/wizard/step5/route';
import { POST as groupUploadPost } from '@/app/api/kyc/documents/[groupId]/upload/route';
import {
  DELETE as fileDelete,
  GET as fileGet,
  POST as filePost,
} from '@/app/api/kyc/documents/files/[fileId]/route';

async function expectBlocked(response: Response) {
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'FINANCE_CAPABILITY_UNAVAILABLE', capability: 'kyc' });
}

describe('authenticated KYC routes for external Asaas accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTenantSession.mockResolvedValue({
      ok: true,
      userId: 'user-ext',
      contaId: 'conta-ext',
      role: 'ADMIN',
      financeIntegrationMode: 'EXTERNAL_ASAAS_ACCOUNT',
    });
  });

  it('bloqueia read, onboarding, refresh, documents e wizard antes dos use cases/parsing', async () => {
    const responses = await Promise.all([
      kycGet(),
      onboardingPost(new Request('http://localhost/api/kyc/onboarding', { method: 'POST', body: '{' })),
      refreshPost(),
      documentsGet(new Request('http://localhost/api/kyc/documents?fresh=1')),
      wizardGet(),
      wizardCompletePost(new Request('http://localhost/api/kyc/wizard/complete', { method: 'POST' })),
      ...[
        step1Post,
        step2Post,
        step3Post,
        step4Post,
        step5Post,
      ].map((post, index) => post(new Request(`http://localhost/api/kyc/wizard/step${index + 1}`, { method: 'POST', body: '{' }))),
    ]);

    for (const response of responses) await expectBlocked(response);
    expect(mocks.asaasFunctions.submitKycData).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.getKycViewModel).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.getKycViewModelFresh).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.getWizardState).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.completeWizard).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.saveWizardStep1).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.saveWizardStep2).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.saveWizardStep3).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.saveWizardStep4).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.saveWizardStep5).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.financeProfileOnboardingDataSchema.parse).not.toHaveBeenCalled();
  });

  it('bloqueia uploads e arquivos antes de quota, multipart parsing ou use cases', async () => {
    const request = new Request('http://localhost/api/kyc/documents/file/upload', { method: 'POST' });
    const context = { params: { fileId: 'file-ext' } };
    const responses = await Promise.all([
      groupUploadPost(request, { params: { groupId: 'group-ext' } }),
      fileGet(request, context),
      fileDelete(request, context),
      filePost(request, context),
    ]);

    for (const response of responses) await expectBlocked(response);
    expect(mocks.rateLimitAsync).not.toHaveBeenCalled();
    expect(mocks.withTenantUploadQuota).not.toHaveBeenCalled();
    expect(mocks.readBoundedFormData).not.toHaveBeenCalled();
    expect(mocks.getKycSnapshotByContaId).not.toHaveBeenCalled();
    expect(mocks.uploadKycDocumentByGroup).not.toHaveBeenCalled();
    expect(mocks.updateKycDocumentFile).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.viewKycDocumentFile).not.toHaveBeenCalled();
    expect(mocks.asaasFunctions.deleteKycDocumentFile).not.toHaveBeenCalled();
  });
});
