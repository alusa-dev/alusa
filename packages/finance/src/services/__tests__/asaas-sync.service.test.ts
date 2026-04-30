import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PaymentStatus } from '@alusa/asaas';

// Mock das dependências externas
vi.mock('@alusa/database', () => ({
  prisma: {
    cobranca: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../use-cases/asaas-ops', () => ({
  getPayment: vi.fn(),
}));

import {
  fetchAsaasPaymentSnapshot,
  persistAsaasPaymentSnapshot,
  syncCobrancaWithAsaas,
  shouldThrottleFetch,
  asaasSyncFlags,
  type AsaasPaymentSnapshot,
} from '../asaas-sync.service';
import { prisma } from '@alusa/database';
import { getPayment } from '../../use-cases/asaas-ops';

const mockPrisma = prisma as unknown as {
  cobranca: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

const mockGetPayment = getPayment as ReturnType<typeof vi.fn>;

describe('asaas-sync.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env vars
    delete process.env.ASAAS_SYNC_THROTTLE_SECONDS;
    delete process.env.ASAAS_SYNC_ENABLE_INMEM_CACHE;
    delete process.env.ASAAS_SYNC_WRITE_ON_GET;
    delete process.env.ASAAS_SYNC_ALLOW_ADMIN_RECONCILE;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('asaasSyncFlags', () => {
    it('getThrottleSeconds returns default 15', () => {
      expect(asaasSyncFlags.getThrottleSeconds()).toBe(15);
    });

    it('getThrottleSeconds respects env var', () => {
      process.env.ASAAS_SYNC_THROTTLE_SECONDS = '30';
      expect(asaasSyncFlags.getThrottleSeconds()).toBe(30);
    });

    it('isWriteOnGetEnabled returns false by default', () => {
      expect(asaasSyncFlags.isWriteOnGetEnabled()).toBe(false);
    });

    it('isWriteOnGetEnabled returns true when enabled', () => {
      process.env.ASAAS_SYNC_WRITE_ON_GET = 'true';
      expect(asaasSyncFlags.isWriteOnGetEnabled()).toBe(true);
    });

    it('isAdminReconcileAllowed returns true by default', () => {
      expect(asaasSyncFlags.isAdminReconcileAllowed()).toBe(true);
    });

    it('isAdminReconcileAllowed returns false when disabled', () => {
      process.env.ASAAS_SYNC_ALLOW_ADMIN_RECONCILE = 'false';
      expect(asaasSyncFlags.isAdminReconcileAllowed()).toBe(false);
    });
  });

  describe('shouldThrottleFetch', () => {
    it('returns throttle=false when no previous fetch', async () => {
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchAt: null });

      const result = await shouldThrottleFetch('cobranca-1');

      expect(result.throttle).toBe(false);
      expect(result.lastFetchAt).toBeNull();
    });

    it('returns throttle=true when fetched recently', async () => {
      const recentDate = new Date(Date.now() - 5000); // 5 seconds ago
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchAt: recentDate });

      const result = await shouldThrottleFetch('cobranca-1');

      expect(result.throttle).toBe(true);
      expect(result.lastFetchAt).toEqual(recentDate);
    });

    it('returns throttle=false when enough time passed', async () => {
      const oldDate = new Date(Date.now() - 20000); // 20 seconds ago
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchAt: oldDate });

      const result = await shouldThrottleFetch('cobranca-1');

      expect(result.throttle).toBe(false);
      expect(result.lastFetchAt).toEqual(oldDate);
    });
  });

  describe('fetchAsaasPaymentSnapshot', () => {
    const mockAsaasPayment = {
      id: 'pay_123',
      status: 'CONFIRMED' as PaymentStatus,
      value: 150,
      netValue: 142.5,
      originalValue: null,
      dueDate: '2024-01-15',
      creditDate: '2024-01-17',
      estimatedCreditDate: '2024-01-17',
      invoiceUrl: 'https://asaas.com/i/123',
      bankSlipUrl: null,
      deleted: false,
    };

    it('fetches and returns snapshot successfully', async () => {
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchAt: null });
      mockGetPayment.mockResolvedValue(mockAsaasPayment);

      const result = await fetchAsaasPaymentSnapshot('cobranca-1', {
        contaId: 'conta-1',
        asaasPaymentId: 'pay_123',
      });

      expect(result.success).toBe(true);
      expect(result.throttled).toBe(false);
      if (result.success && !result.throttled) {
        expect(result.snapshot.asaasPaymentId).toBe('pay_123');
        expect(result.snapshot.asaasStatus).toBe('CONFIRMED');
        expect(result.snapshot.value).toBe(150);
        expect(result.snapshot.netValue).toBe(142.5);
        expect(result.snapshot.feeValue).toBe(7.5);
        expect(result.snapshot.creditDate).toBe('2024-01-17');
      }
    });

    it('returns throttled when recently fetched', async () => {
      const recentDate = new Date(Date.now() - 5000);
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchAt: recentDate });

      const result = await fetchAsaasPaymentSnapshot('cobranca-1', {
        contaId: 'conta-1',
        asaasPaymentId: 'pay_123',
      });

      expect(result.success).toBe(true);
      expect(result.throttled).toBe(true);
      if (result.success && result.throttled) {
        expect(result.snapshot).toBeNull();
        expect(result.lastFetchAt).toEqual(recentDate);
      }

      expect(mockGetPayment).not.toHaveBeenCalled();
    });

    it('bypasses throttle with forceRefresh', async () => {
      const recentDate = new Date(Date.now() - 5000);
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchAt: recentDate });
      mockGetPayment.mockResolvedValue(mockAsaasPayment);

      const result = await fetchAsaasPaymentSnapshot('cobranca-1', {
        contaId: 'conta-1',
        asaasPaymentId: 'pay_123',
        forceRefresh: true,
      });

      expect(result.success).toBe(true);
      expect(result.throttled).toBe(false);
      expect(mockGetPayment).toHaveBeenCalled();
    });

    it('returns error on API failure', async () => {
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchAt: null });
      mockGetPayment.mockRejectedValue(new Error('API Error'));

      const result = await fetchAsaasPaymentSnapshot('cobranca-1', {
        contaId: 'conta-1',
        asaasPaymentId: 'pay_123',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('API Error');
      }
    });
  });

  describe('persistAsaasPaymentSnapshot', () => {
    const mockSnapshot: AsaasPaymentSnapshot = {
      asaasPaymentId: 'pay_123',
      asaasStatus: 'CONFIRMED',
      value: 150,
      netValue: 142.5,
      originalValue: null,
      feeValue: 7.5,
      dueDate: '2024-01-15',
      creditDate: '2024-01-17',
      estimatedCreditDate: '2024-01-17',
      invoiceUrl: 'https://asaas.com/i/123',
      bankSlipUrl: null,
      snapshotHash: 'abc123',
      fetchedAt: new Date(),
    };

    it('updates cobranca with snapshot data', async () => {
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchHash: null });
      mockPrisma.cobranca.update.mockResolvedValue({});

      const result = await persistAsaasPaymentSnapshot('cobranca-1', mockSnapshot);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.updated).toBe(true);
        expect(result.liquidacaoStatus).toBe('DISPONIVEL');
      }

      expect(mockPrisma.cobranca.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cobranca-1' },
          data: expect.objectContaining({
            asaasStatus: 'CONFIRMED',
            asaasValue: 150,
            asaasNetValue: 142.5,
            asaasFeeValue: 7.5,
            liquidacaoStatus: 'DISPONIVEL',
          }),
        })
      );
    });

    it('skips update when hash unchanged', async () => {
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchHash: 'abc123' });
      mockPrisma.cobranca.update.mockResolvedValue({});

      const result = await persistAsaasPaymentSnapshot('cobranca-1', mockSnapshot);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.updated).toBe(false);
      }

      // Should only update timestamp, not all fields
      expect(mockPrisma.cobranca.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastAsaasFetchAt: expect.any(Date) },
        })
      );
    });

    it('computes PENDENTE liquidacao when no creditDate', async () => {
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchHash: null });
      mockPrisma.cobranca.update.mockResolvedValue({});

      const snapshotNoCreditDate: AsaasPaymentSnapshot = {
        ...mockSnapshot,
        creditDate: null,
        snapshotHash: 'different',
      };

      const result = await persistAsaasPaymentSnapshot('cobranca-1', snapshotNoCreditDate);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.liquidacaoStatus).toBe('PENDENTE');
      }
    });

    it('computes NAO_APLICAVEL for PENDING status', async () => {
      mockPrisma.cobranca.findUnique.mockResolvedValue({ lastAsaasFetchHash: null });
      mockPrisma.cobranca.update.mockResolvedValue({});

      const snapshotPending: AsaasPaymentSnapshot = {
        ...mockSnapshot,
        asaasStatus: 'PENDING',
        creditDate: null,
        snapshotHash: 'different2',
      };

      const result = await persistAsaasPaymentSnapshot('cobranca-1', snapshotPending);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.liquidacaoStatus).toBe('NAO_APLICAVEL');
      }
    });
  });

  describe('syncCobrancaWithAsaas', () => {
    it('skips persist when source=get_endpoint and write disabled', async () => {
      process.env.ASAAS_SYNC_WRITE_ON_GET = 'false';

      const result = await syncCobrancaWithAsaas('cobranca-1', {
        contaId: 'conta-1',
        asaasPaymentId: 'pay_123',
        source: 'get_endpoint',
      });

      expect(result.success).toBe(true);
      expect(result.updated).toBe(false);
      expect(mockGetPayment).not.toHaveBeenCalled();
    });

    it('returns error when source=admin_reconcile and reconcile disabled', async () => {
      process.env.ASAAS_SYNC_ALLOW_ADMIN_RECONCILE = 'false';

      const result = await syncCobrancaWithAsaas('cobranca-1', {
        contaId: 'conta-1',
        asaasPaymentId: 'pay_123',
        source: 'admin_reconcile',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('desabilitada');
    });

    it('always allows webhook source', async () => {
      mockPrisma.cobranca.findUnique.mockResolvedValue({ 
        lastAsaasFetchAt: null,
        lastAsaasFetchHash: null,
      });
      mockGetPayment.mockResolvedValue({
        id: 'pay_123',
        status: 'CONFIRMED',
        value: 150,
        netValue: 142.5,
        dueDate: '2024-01-15',
        creditDate: '2024-01-17',
        deleted: false,
      });
      mockPrisma.cobranca.update.mockResolvedValue({});

      const result = await syncCobrancaWithAsaas('cobranca-1', {
        contaId: 'conta-1',
        asaasPaymentId: 'pay_123',
        source: 'webhook',
      });

      expect(result.success).toBe(true);
      expect(mockGetPayment).toHaveBeenCalled();
    });
  });
});
