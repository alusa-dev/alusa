import { describe, it, expect, vi, beforeEach } from 'vitest';

import { listTransfers } from '../list-transfers';

vi.mock('@alusa/database', () => {
  return {
    loadAsaasCredentials: vi.fn(),
    prisma: {
      transferRequest: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      webhookAsaas: {
        findMany: vi.fn(),
      },
      pixTransferSession: {
        updateMany: vi.fn(),
      },
    },
  };
});

vi.mock('@alusa/asaas', () => ({
  getTransfer: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn(async () => {}) },
}));

vi.mock('../transfers/reconcile-open-transfers', () => ({
  reconcileOpenTransfers: vi.fn(async () => ({
    reconciled: 0,
    officialTransfersById: new Map(),
  })),
}));

describe('listTransfers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve listar e normalizar campos', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { reconcileOpenTransfers } = await import('../transfers/reconcile-open-transfers');

    const officialMap = new Map();
    officialMap.set('asaas_tr_1', {
      id: 'asaas_tr_1',
      object: 'transfer',
      dateCreated: '2026-01-01',
      value: 10,
      netValue: 10,
      status: 'DONE',
      externalReference: 'transfer:tr1',
      operationType: 'TED',
      type: 'BANK_ACCOUNT',
    });
    vi.mocked(reconcileOpenTransfers).mockResolvedValueOnce({
      reconciled: 1,
      officialTransfersById: officialMap,
    });

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);

    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      {
        id: 'tr1',
        externalReference: 'transfer:tr1',
        asaasTransferId: 'asaas_tr_1',
        value: { toString: () => '10.00' },
        destination: {
          type: 'BANK_ACCOUNT',
          bank: { code: '260' },
          ownerName: 'Elaine Cristina dos Santos Costa',
          cpfCnpj: '19786211122',
          agency: '0001',
          account: '12345',
          accountDigit: '0',
        },
        description: 'Repasse Elaine',
        scheduleDate: new Date('2026-01-02T00:00:00.000Z'),
        status: 'DONE',
        statusUpdatedAt: new Date('2026-01-01T00:01:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ] as never);

    vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValueOnce([
      {
        asaasTransferId: 'asaas_tr_1',
        payload: {
          transfer: {
            bankAccount: {
              ownerName: 'Elaine Cristina dos Santos Costa',
              cpfCnpj: '19786211122',
              bank: { name: 'Nu Pagamentos S.A.', code: '260' },
            },
          },
        },
      },
    ] as never);

    const res = await listTransfers({ contaId: 't1', limit: 10, offset: 0, direction: 'desc' });

    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: 'tr1',
      externalReference: 'transfer:tr1',
      asaasTransferId: 'asaas_tr_1',
      value: 10,
      feeValue: 0,
      netValue: 10,
      status: 'DONE',
      operation: 'TED',
      recipientName: 'Elaine Cristina dos Santos Costa',
      cpfCnpjMasked: '***.862.111-**',
      bankName: 'Nu Pagamentos S.A.',
      description: 'Repasse Elaine',
    });
  });

  it('deve enriquecer transferência PIX com nome e banco vindos do webhook persistido', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null as never);

    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      {
        id: 'tr2',
        externalReference: 'transfer:tr2',
        asaasTransferId: 'asaas_pix_1',
        value: { toString: () => '1.11' },
        destination: {
          type: 'PIX',
          pixAddressKey: 'cliente-a00001@pix.bcb.gov.br',
          pixAddressKeyType: 'EMAIL',
        },
        description: 'Validacao webhook',
        scheduleDate: null,
        status: 'DONE',
        statusUpdatedAt: new Date('2026-03-25T02:02:57.127Z'),
        createdAt: new Date('2026-03-25T02:02:45.439Z'),
      },
    ] as never);

    vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValueOnce([
      {
        asaasTransferId: 'asaas_pix_1',
        payload: {
          transfer: {
            bankAccount: {
              ownerName: 'Joao Silva',
              cpfCnpj: '***.911.111-**',
              bank: { name: 'Banco Virtual - BACEN', code: null },
            },
          },
        },
      },
    ] as never);

    const res = await listTransfers({ contaId: 't1', limit: 10, offset: 0, direction: 'desc' });

    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: 'tr2',
      operation: 'PIX',
      recipientName: 'Joao Silva',
      cpfCnpjMasked: '***.911.111-**',
      bankName: 'Banco Virtual - BACEN',
      feeValue: null,
      netValue: 1.11,
    });
  });

  it('deve refletir taxa oficial e valor liquido oficial do Asaas na listagem', async () => {
    const { prisma, loadAsaasCredentials } = await import('@alusa/database');
    const { getTransfer } = await import('@alusa/asaas');

    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce({ apiKey: 'asaas_key' } as never);
    vi.mocked(prisma.transferRequest.findMany).mockResolvedValueOnce([
      {
        id: 'tr3',
        externalReference: 'transfer:tr3',
        asaasTransferId: 'asaas_tr_3',
        value: { toString: () => '15.36' },
        destination: {
          type: 'PIX',
          pixAddressKey: 'cliente-a00001@pix.bcb.gov.br',
          pixAddressKeyType: 'EMAIL',
        },
        description: 'Repasse oficial',
          scheduleDate: null,
          status: 'DONE',
          statusUpdatedAt: new Date('2026-03-25T02:02:57.127Z'),
          createdAt: new Date('2026-03-25T02:02:45.439Z'),
        },
      ] as never);
    vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(getTransfer).mockResolvedValueOnce({
      id: 'asaas_tr_3',
      object: 'transfer',
      dateCreated: '2026-03-25',
      value: 15.36,
      netValue: 13.36,
      transferFee: 2,
      status: 'DONE',
      externalReference: 'transfer:tr3',
      operationType: 'PIX',
      type: 'PIX',
      effectiveDate: '2026-03-25',
    } as never);

    const res = await listTransfers({ contaId: 't1', limit: 10, offset: 0, direction: 'desc' });

    expect(res.items[0]).toMatchObject({
      id: 'tr3',
      value: 15.36,
      feeValue: 2,
      netValue: 13.36,
      operation: 'PIX',
      transferDate: '2026-03-25',
    });
  });
});
