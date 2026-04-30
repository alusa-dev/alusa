import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isAuthorizedCategory,
  validateFinanceStatusChange,
  updateMatriculaFinanceStatus,
  updateFinanceStatusFromPayment,
  updateFinanceStatusFromSubscription,
  tryUpdateFinanceStatus,
} from '../finance-status-guard';
import type { EventCategory } from '../../webhooks/asaas-event-registry';
import type { StatusFinanceiro } from '@prisma/client';

// Mock Prisma
vi.mock('@alusa/database', () => ({
  prisma: {
    matricula: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@alusa/database';

const mockFindUnique = vi.mocked(prisma.matricula.findUnique);
const mockUpdate = vi.mocked(prisma.matricula.update);

// Constantes para status válidos (conforme schema.prisma StatusFinanceiro)
const STATUS_ADIMPLENTE: StatusFinanceiro = 'ADIMPLENTE';
const STATUS_PENDENTE_TAXA: StatusFinanceiro = 'PENDENTE_TAXA';
const STATUS_PENDENTE_FINANCEIRO: StatusFinanceiro = 'PENDENTE_FINANCEIRO';
const STATUS_INADIMPLENTE: StatusFinanceiro = 'INADIMPLENTE';
const STATUS_SUSPENSO: StatusFinanceiro = 'SUSPENSO';

describe('finance-status-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAuthorizedCategory', () => {
    it('deve autorizar PAYMENT', () => {
      expect(isAuthorizedCategory('PAYMENT')).toBe(true);
    });

    it('deve autorizar SUBSCRIPTION', () => {
      expect(isAuthorizedCategory('SUBSCRIPTION')).toBe(true);
    });

    it('deve bloquear TRANSFER', () => {
      expect(isAuthorizedCategory('TRANSFER')).toBe(false);
    });

    it('deve bloquear ACCOUNT_STATUS', () => {
      expect(isAuthorizedCategory('ACCOUNT_STATUS')).toBe(false);
    });

    it('deve bloquear INVOICE', () => {
      expect(isAuthorizedCategory('INVOICE')).toBe(false);
    });

    it('deve bloquear BILL', () => {
      expect(isAuthorizedCategory('BILL')).toBe(false);
    });

    it('deve bloquear INTERNAL_TRANSFER', () => {
      expect(isAuthorizedCategory('INTERNAL_TRANSFER')).toBe(false);
    });

    it('deve bloquear ANTICIPATION', () => {
      expect(isAuthorizedCategory('ANTICIPATION')).toBe(false);
    });

    it('deve bloquear UNKNOWN', () => {
      expect(isAuthorizedCategory('UNKNOWN')).toBe(false);
    });
  });

  describe('validateFinanceStatusChange', () => {
    it('deve permitir PAYMENT', () => {
      const result = validateFinanceStatusChange({
        eventCategory: 'PAYMENT',
        eventName: 'PAYMENT_RECEIVED',
      });
      expect(result.allowed).toBe(true);
    });

    it('deve permitir SUBSCRIPTION', () => {
      const result = validateFinanceStatusChange({
        eventCategory: 'SUBSCRIPTION',
        eventName: 'SUBSCRIPTION_CREATED',
      });
      expect(result.allowed).toBe(true);
    });

    it('deve bloquear TRANSFER com razão', () => {
      const result = validateFinanceStatusChange({
        eventCategory: 'TRANSFER',
        eventName: 'TRANSFER_CREATED',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('TRANSFER');
      expect(result.reason).toContain('não autorizada');
    });

    it('deve bloquear UNKNOWN com razão', () => {
      const result = validateFinanceStatusChange({
        eventCategory: 'UNKNOWN',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('UNKNOWN');
    });
  });

  describe('updateMatriculaFinanceStatus', () => {
    it('deve bloquear alteração de categoria não autorizada', async () => {
      const result = await updateMatriculaFinanceStatus({
        matriculaId: 'mat-123',
        newStatus: STATUS_ADIMPLENTE,
        eventCategory: 'TRANSFER',
        eventName: 'TRANSFER_CREATED',
      });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('não autorizada');
      expect(mockFindUnique).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('deve retornar erro se matrícula não existe', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await updateMatriculaFinanceStatus({
        matriculaId: 'mat-inexistente',
        newStatus: STATUS_ADIMPLENTE,
        eventCategory: 'PAYMENT',
        eventName: 'PAYMENT_RECEIVED',
      });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.blockReason).toContain('não encontrada');
    });

    it('deve ser idempotente (mesmo status não atualiza)', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'mat-123',
        statusFinanceiro: STATUS_ADIMPLENTE,
      } as any);

      const result = await updateMatriculaFinanceStatus({
        matriculaId: 'mat-123',
        newStatus: STATUS_ADIMPLENTE,
        eventCategory: 'PAYMENT',
        eventName: 'PAYMENT_RECEIVED',
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(STATUS_ADIMPLENTE);
      expect(result.newStatus).toBe(STATUS_ADIMPLENTE);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('deve atualizar status de PAYMENT', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'mat-123',
        statusFinanceiro: STATUS_PENDENTE_FINANCEIRO,
      } as any);
      mockUpdate.mockResolvedValue({} as any);

      const result = await updateMatriculaFinanceStatus({
        matriculaId: 'mat-123',
        newStatus: STATUS_ADIMPLENTE,
        eventCategory: 'PAYMENT',
        eventName: 'PAYMENT_RECEIVED',
        reason: 'Pagamento confirmado',
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(STATUS_PENDENTE_FINANCEIRO);
      expect(result.newStatus).toBe(STATUS_ADIMPLENTE);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'mat-123' },
        data: { statusFinanceiro: STATUS_ADIMPLENTE },
      });
    });

    it('deve atualizar status de SUBSCRIPTION', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'mat-456',
        statusFinanceiro: STATUS_ADIMPLENTE,
      } as any);
      mockUpdate.mockResolvedValue({} as any);

      const result = await updateMatriculaFinanceStatus({
        matriculaId: 'mat-456',
        newStatus: STATUS_INADIMPLENTE,
        eventCategory: 'SUBSCRIPTION',
        eventName: 'SUBSCRIPTION_OVERDUE',
        reason: 'Assinatura vencida',
      });

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(STATUS_ADIMPLENTE);
      expect(result.newStatus).toBe(STATUS_INADIMPLENTE);
    });
  });

  describe('updateFinanceStatusFromPayment', () => {
    it('deve usar categoria PAYMENT automaticamente', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'mat-123',
        statusFinanceiro: STATUS_PENDENTE_FINANCEIRO,
      } as any);
      mockUpdate.mockResolvedValue({} as any);

      const result = await updateFinanceStatusFromPayment({
        matriculaId: 'mat-123',
        newStatus: STATUS_ADIMPLENTE,
        eventName: 'PAYMENT_CONFIRMED',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('updateFinanceStatusFromSubscription', () => {
    it('deve usar categoria SUBSCRIPTION automaticamente', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'mat-123',
        statusFinanceiro: STATUS_ADIMPLENTE,
      } as any);
      mockUpdate.mockResolvedValue({} as any);

      const result = await updateFinanceStatusFromSubscription({
        matriculaId: 'mat-123',
        newStatus: STATUS_SUSPENSO,
        eventName: 'SUBSCRIPTION_DELETED',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('tryUpdateFinanceStatus', () => {
    it('deve bloquear INVOICE tentando alterar', async () => {
      const result = await tryUpdateFinanceStatus({
        matriculaId: 'mat-123',
        newStatus: STATUS_ADIMPLENTE,
        eventCategory: 'INVOICE',
        eventName: 'INVOICE_CREATED',
      });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });

    it('deve bloquear BILL tentando alterar', async () => {
      const result = await tryUpdateFinanceStatus({
        matriculaId: 'mat-123',
        newStatus: STATUS_INADIMPLENTE,
        eventCategory: 'BILL',
        eventName: 'BILL_OVERDUE',
      });

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });
  });

  describe('invariantes de segurança', () => {
    const categoriasNaoAutorizadas: EventCategory[] = [
      'TRANSFER',
      'ACCOUNT_STATUS',
      'INTERNAL_TRANSFER',
      'INVOICE',
      'BILL',
      'ANTICIPATION',
      'PHONE_RECHARGE',
      'CHECKOUT',
      'BALANCE',
      'ACCESS_TOKEN',
      'PIX_AUTOMATIC',
    ];

    it.each(categoriasNaoAutorizadas)(
      'deve bloquear categoria %s de alterar financeStatus',
      async (categoria) => {
        const result = await tryUpdateFinanceStatus({
          matriculaId: 'mat-test',
          newStatus: STATUS_ADIMPLENTE,
          eventCategory: categoria,
          eventName: `${categoria}_TEST`,
        });

        expect(result.success).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.blockReason).toContain(categoria);
      }
    );
  });
});
