/**
 * Testes unitários do guard requireKycSnapshotApproved.
 *
 * Mocka: getKycSnapshot, financeProfileService, prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KycSnapshot } from '../../../dtos/kyc/kyc-snapshot.dto';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockGetKycSnapshot = vi.fn<[string, { fresh?: boolean }?], Promise<KycSnapshot | null>>();

vi.mock('../../kyc/get-kyc-snapshot', () => ({
  getKycSnapshot: (...args: [string, { fresh?: boolean }?]) => mockGetKycSnapshot(...args),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: { findUnique: vi.fn(async () => ({ status: 'PENDING' })) },
    financeProfile: { findUnique: vi.fn(async () => ({ id: 'fp_001', isOnboardingCompleted: false })) },
  },
}));

vi.mock('../../../foundation/finance-profile.service', () => ({
  financeProfileService: {
    getOrCreateByTenant: vi.fn(async () => ({ id: 'fp_001', isOnboardingCompleted: false })),
    syncRegulatoryState: vi.fn(async () => undefined),
  },
}));

vi.mock('../../asaas-account/reconcile-asaas-account', () => ({
  reconcileAsaasAccount: vi.fn(async () => undefined),
}));

import { requireKycSnapshotApproved } from '../../../foundation/kyc-guard';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<KycSnapshot> = {}): KycSnapshot {
  return {
    generalStatus: 'APPROVED',
    documentationStatus: 'APPROVED',
    bankAccountStatus: 'APPROVED',
    processStatus: 'APPROVED',
    commercialInfoStatus: null,
    commercialInfoScheduledDate: null,
    hasBlockingPending: false,
    nextActions: [],
    rejectReasons: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('requireKycSnapshotApproved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna ok(snapshot) quando todas as áreas estão APPROVED', async () => {
    const snapshot = makeSnapshot();
    mockGetKycSnapshot.mockResolvedValue(snapshot);

    const result = await requireKycSnapshotApproved('conta_001');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasBlockingPending).toBe(false);
    }
  });

  it('retorna err KYC_REQUIRED quando snapshot tem blocking pendente', async () => {
    const snapshot = makeSnapshot({
      hasBlockingPending: true,
      generalStatus: 'PENDING',
      documentationStatus: 'APPROVED',
      bankAccountStatus: 'APPROVED',
    });
    mockGetKycSnapshot.mockResolvedValue(snapshot);

    const result = await requireKycSnapshotApproved('conta_001');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({ code: 'KYC_REQUIRED' });
      expect(result.error).toHaveProperty('reasons');
      expect((result.error as { reasons: string[] }).reasons).toContain('general: PENDING');
    }
  });

  it('retorna err KYC_REQUIRED quando snapshot é null (subconta indisponível)', async () => {
    mockGetKycSnapshot.mockResolvedValue(null);

    const result = await requireKycSnapshotApproved('conta_001');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({ code: 'KYC_REQUIRED' });
      expect((result.error as { reasons: string[] }).reasons).toContain('Subconta não disponível');
    }
  });

  it('usa fast-path quando isOnboardingCompleted e snapshot OK', async () => {
    const { financeProfileService } = await import('../../../foundation/finance-profile.service');
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({
      id: 'fp_001',
      isOnboardingCompleted: true,
    } as never);

    const snapshot = makeSnapshot();
    mockGetKycSnapshot.mockResolvedValue(snapshot);

    const result = await requireKycSnapshotApproved('conta_001');
    expect(result.success).toBe(true);
    // Fast-path: chamada sem fresh
    expect(mockGetKycSnapshot).toHaveBeenCalledWith('fp_001');
  });

  it('force fresh quando onboarding completo mas snapshot blocking', async () => {
    const { financeProfileService } = await import('../../../foundation/finance-profile.service');
    vi.mocked(financeProfileService.getOrCreateByTenant).mockResolvedValueOnce({
      id: 'fp_001',
      isOnboardingCompleted: true,
    } as never);

    // Primeiro chamado (fast-path) retorna blocking
    const blockingSnapshot = makeSnapshot({
      hasBlockingPending: true,
      bankAccountStatus: 'PENDING',
    });
    // Segundo chamado (fresh) retorna blocking ainda
    mockGetKycSnapshot
      .mockResolvedValueOnce(blockingSnapshot)
      .mockResolvedValueOnce(blockingSnapshot);

    const result = await requireKycSnapshotApproved('conta_001');
    expect(result.success).toBe(false);
    // Deve ter chamado 2x: fast-path + fresh
    expect(mockGetKycSnapshot).toHaveBeenCalledTimes(2);
    expect(mockGetKycSnapshot).toHaveBeenLastCalledWith('fp_001', { fresh: true });
  });

  it('retorna err(ERRO_INTERNO) quando exceção inesperada', async () => {
    const { financeProfileService } = await import('../../../foundation/finance-profile.service');
    vi.mocked(financeProfileService.getOrCreateByTenant).mockRejectedValueOnce(new Error('DB down'));

    const result = await requireKycSnapshotApproved('conta_001');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({ code: 'ERRO_INTERNO' });
    }
  });

  it('lista reasons para cada área não aprovada', async () => {
    const snapshot = makeSnapshot({
      hasBlockingPending: true,
      generalStatus: 'REJECTED',
      documentationStatus: 'PENDING',
      bankAccountStatus: 'NOT_SENT',
    });
    mockGetKycSnapshot.mockResolvedValue(snapshot);

    const result = await requireKycSnapshotApproved('conta_001');
    expect(result.success).toBe(false);
    if (!result.success) {
      const reasons = (result.error as { reasons: string[] }).reasons;
      expect(reasons).toContain('general: REJECTED');
      expect(reasons).toContain('documentation: PENDING');
      expect(reasons).toContain('bankAccount: NOT_SENT');
    }
  });

  it('retorna erro comercial quando commercialInfoStatus = EXPIRED', async () => {
    const snapshot = makeSnapshot({
      commercialInfoStatus: 'EXPIRED',
      commercialInfoScheduledDate: '2026-03-01',
    });
    mockGetKycSnapshot.mockResolvedValue(snapshot);

    const result = await requireKycSnapshotApproved('conta_001');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({ code: 'COMMERCIAL_INFO_EXPIRED' });
    }
  });
});
