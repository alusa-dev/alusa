/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import { contaFinanceOnboardingResultDTOSchema } from '@/features/conta/dtos';
import { mapContaFinanceOnboardingResultToDTO } from '@/features/conta/mappers';

describe('conta finance onboarding dto', () => {
  it('aceita o payload real de myAccountStatus e documents retornado pelo Asaas', () => {
    const result = contaFinanceOnboardingResultDTOSchema.parse({
      data: {
        financeProfile: {
          id: 'fp_123',
          status: 'APPROVED',
          isOnboardingCompleted: true,
          onboardingCompletedAt: null,
          lastAsaasSyncAt: null,
          mobilePhone: '11999999999',
          incomeValue: 5000,
          address: 'Rua Nova II',
          addressNumber: '196',
          province: 'Sao Joao',
          postalCode: '69553315',
          complement: 'Casa',
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        financialAccount: {
          commercialInfo: {
            status: 'APPROVED',
            personType: 'JURIDICA',
            cpfCnpj: '11222333000181',
          },
          commercialInfoStatus: null,
          commercialInfoScheduledDate: null,
          commercialInfoExpiration: null,
          myAccountStatus: {
            id: 'acc_123',
            commercialInfo: 'APPROVED',
            commercialInfoExpiration: { isExpired: false, scheduledDate: '2026-12-31' },
            bankAccountInfo: 'APPROVED',
            documentation: 'APPROVED',
            general: 'APPROVED',
          },
          documents: {
            rejectReasons: null,
            data: [
              {
                id: 'doc_123',
                status: 'APPROVED',
                title: 'Documentos de identificação',
              },
            ],
          },
          documentsNotReady: false,
          retryAfterMs: null,
        },
      },
    });

    expect(result.data.financialAccount.myAccountStatus?.general).toBe('APPROVED');
    expect(result.data.financialAccount.myAccountStatus?.commercialInfoExpiration).toEqual({
      isExpired: false,
      scheduledDate: '2026-12-31',
    });
    expect(result.data.financialAccount.documents?.data).toHaveLength(1);
  });

  it('normaliza incomeValue decimal-like do Prisma no financeProfile', () => {
    const result = mapContaFinanceOnboardingResultToDTO({
      data: {
        financeProfile: {
          id: 'fp_123',
          incomeValue: {
            toNumber: () => 5000,
            toString: () => '5000',
          },
          updatedAt: new Date('2026-03-23T10:00:00.000Z'),
          createdAt: new Date('2026-03-22T10:00:00.000Z'),
        },
        financialAccount: {
          commercialInfo: null,
          commercialInfoStatus: null,
          commercialInfoScheduledDate: null,
          commercialInfoExpiration: null,
          myAccountStatus: null,
          documents: null,
          documentsNotReady: false,
          retryAfterMs: null,
        },
      },
    });

    expect(result.data.financeProfile?.incomeValue).toBe(5000);
    expect(result.data.financeProfile?.updatedAt).toBe('2026-03-23T10:00:00.000Z');
    expect(result.data.financeProfile?.createdAt).toBe('2026-03-22T10:00:00.000Z');
  });
});