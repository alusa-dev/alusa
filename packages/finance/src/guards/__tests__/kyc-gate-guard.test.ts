/**
 * Testes do KYC Gate Guard.
 *
 * Garante que:
 * - Operações financeiras são bloqueadas quando onboarding não é APPROVED
 * - commercialInfo EXPIRED bloqueia operações
 * - Conta sem subconta é bloqueada
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasAccount: { findFirst: mockFindFirst },
  },
}));

import { checkKycGate } from '../../guards/kyc-gate.guard';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkKycGate', () => {
  it('permite quando status=APPROVED e commercialInfo não expirado', async () => {
    mockFindFirst.mockResolvedValue({
      status: 'APPROVED',
      commercialInfoStatus: null,
    });

    const result = await checkKycGate('conta-1');
    expect(result.allowed).toBe(true);
    expect(result.onboardingStatus).toBe('APPROVED');
  });

  it('permite quando status=APPROVED e commercialInfo=EXPIRING_SOON', async () => {
    mockFindFirst.mockResolvedValue({
      status: 'APPROVED',
      commercialInfoStatus: 'EXPIRING_SOON',
    });

    const result = await checkKycGate('conta-1');
    expect(result.allowed).toBe(true);
  });

  it('bloqueia quando status=UNDER_REVIEW', async () => {
    mockFindFirst.mockResolvedValue({
      status: 'UNDER_REVIEW',
      commercialInfoStatus: null,
    });

    const result = await checkKycGate('conta-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('não aprovado');
  });

  it('bloqueia quando status=REJECTED', async () => {
    mockFindFirst.mockResolvedValue({
      status: 'REJECTED',
      commercialInfoStatus: null,
    });

    const result = await checkKycGate('conta-1');
    expect(result.allowed).toBe(false);
  });

  it('bloqueia quando status=APPROVED mas commercialInfo=EXPIRED', async () => {
    mockFindFirst.mockResolvedValue({
      status: 'APPROVED',
      commercialInfoStatus: 'EXPIRED',
    });

    const result = await checkKycGate('conta-1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('expirados');
  });

  it('bloqueia quando AsaasAccount não existe', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await checkKycGate('conta-inexistente');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('não encontrada');
  });

  it('bloqueia quando status=CREATED (provisioning incompleto)', async () => {
    mockFindFirst.mockResolvedValue({
      status: 'CREATED',
      commercialInfoStatus: null,
    });

    const result = await checkKycGate('conta-1');
    expect(result.allowed).toBe(false);
  });

  it('bloqueia quando status=PROVISIONING', async () => {
    mockFindFirst.mockResolvedValue({
      status: 'PROVISIONING',
      commercialInfoStatus: null,
    });

    const result = await checkKycGate('conta-1');
    expect(result.allowed).toBe(false);
  });
});
