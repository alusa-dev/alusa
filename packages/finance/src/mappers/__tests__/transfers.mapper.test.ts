import { describe, it, expect } from 'vitest';
import {
  mapRequestWithdrawDTOToInput,
  mapRequestWithdrawOutputToDTO,
  mapTransferToListItemDTO,
  mapListTransfersOutputToDTO,
  mapListTransfersQueryToInput,
} from '../transfers.mapper';
import type { RequestWithdrawDTO } from '../../dtos/transfers/request-withdraw.dto';
import type { RequestWithdrawOutput } from '../../use-cases/request-withdraw';
import type { TransferListItem, ListTransfersOutput } from '../../use-cases/list-transfers';
import type { ListTransfersQueryParsed } from '../../dtos/transfers/list-transfers-query.dto';

describe('mapRequestWithdrawDTOToInput', () => {
  const context = {
    contaId: 'conta-123',
    idempotencyKey: 'idem-456',
    actorId: 'user-789',
  };

  it('deve mapear DTO PIX para input corretamente', () => {
    const dto: RequestWithdrawDTO = {
      amount: '150.50',
      destination: {
        type: 'PIX',
        pixAddressKey: '12345678901',
        pixAddressKeyType: 'CPF',
      },
    };

    const result = mapRequestWithdrawDTOToInput(dto, context);

    expect(result).toEqual({
      contaId: 'conta-123',
      value: 150.50,
      destination: {
        type: 'PIX',
        pixAddressKey: '12345678901',
        pixAddressKeyType: 'CPF',
      },
      description: undefined,
      scheduleDate: undefined,
      idempotencyKey: 'idem-456',
      actor: { type: 'USER', id: 'user-789' },
    });
  });

  it('deve mapear DTO conta bancária para input corretamente', () => {
    const dto: RequestWithdrawDTO = {
      amount: '1000.00',
      destination: {
        type: 'BANK_ACCOUNT',
        bank: { code: '341' },
        accountName: 'CORRENTE',
        ownerName: 'João da Silva',
        cpfCnpj: '12345678901',
        agency: '1234',
        account: '12345',
        accountDigit: '6',
      },
      description: 'Saque mensal',
      scheduleDate: '2025-02-15',
    };

    const result = mapRequestWithdrawDTOToInput(dto, context);

    expect(result.value).toBe(1000);
    expect(result.destination.type).toBe('BANK_ACCOUNT');
    expect(result.description).toBe('Saque mensal');
    expect(result.scheduleDate).toBe('2025-02-15');
  });

  it('deve converter amount string para number corretamente', () => {
    const dto: RequestWithdrawDTO = {
      amount: '99.99',
      destination: {
        type: 'PIX',
        pixAddressKey: 'test@email.com',
        pixAddressKeyType: 'EMAIL',
      },
    };

    const result = mapRequestWithdrawDTOToInput(dto, context);
    expect(result.value).toBe(99.99);
  });
});

describe('mapRequestWithdrawOutputToDTO', () => {
  it('deve mapear output para DTO corretamente', () => {
    const output: RequestWithdrawOutput = {
      transferRequestId: 'tr-123',
      externalReference: 'asaas_tr_abc',
      status: 'PENDING',
    };

    const result = mapRequestWithdrawOutputToDTO(output, '150.00');

    expect(result.id).toBe('tr-123');
    expect(result.externalReference).toBe('asaas_tr_abc');
    expect(result.status).toBe('PENDING');
    expect(result.amount).toBe('150.00');
    expect(result.createdAt).toBeDefined();
  });
});

describe('mapTransferToListItemDTO', () => {
  it('deve mapear item para DTO com formatação decimal', () => {
    const item: TransferListItem = {
      id: 'tr-1',
      externalReference: 'asaas_1',
      value: 100.5,
      netValue: 100.5,
      status: 'DONE',
      operation: 'TED',
      recipientName: 'Joao da Silva',
      cpfCnpjMasked: '***.456.789-**',
      bankName: 'Banco 341',
      scheduleDate: '2025-02-02T00:00:00.000Z',
      transferDate: '2025-02-01T10:05:00.000Z',
      description: 'Fornecedor principal',
      createdAt: '2025-02-01T10:00:00.000Z',
      statusUpdatedAt: '2025-02-01T10:05:00.000Z',
    };

    const result = mapTransferToListItemDTO(item);

    expect(result.id).toBe('tr-1');
    expect(result.amount).toBe('100.50');
    expect(result.netAmount).toBe('100.50');
    expect(result.status).toBe('DONE');
    expect(result.operation).toBe('TED');
    expect(result.recipientName).toBe('Joao da Silva');
    expect(result.cpfCnpj).toBe('***.456.789-**');
    expect(result.bankName).toBe('Banco 341');
    expect(result.description).toBe('Fornecedor principal');
  });

  it('deve formatar valor inteiro com .00', () => {
    const item: TransferListItem = {
      id: 'tr-2',
      externalReference: 'asaas_2',
      value: 200,
      netValue: 200,
      status: 'PENDING',
      operation: 'PIX',
      recipientName: 'Maria Souza',
      cpfCnpjMasked: null,
      bankName: 'Pix',
      scheduleDate: null,
      transferDate: null,
      description: null,
      createdAt: '2025-02-01T10:00:00.000Z',
      statusUpdatedAt: null,
    };

    const result = mapTransferToListItemDTO(item);
    expect(result.amount).toBe('200.00');
  });
});

describe('mapListTransfersOutputToDTO', () => {
  it('deve mapear output de listagem para DTO com paginação', () => {
    const output: ListTransfersOutput = {
      items: [
        {
          id: 'tr-1',
          externalReference: 'asaas_1',
          value: 100,
          netValue: 100,
          status: 'DONE',
          operation: 'TED',
          recipientName: 'Joao da Silva',
          cpfCnpjMasked: '***.456.789-**',
          bankName: 'Banco 341',
          scheduleDate: '2025-02-02T00:00:00.000Z',
          transferDate: '2025-02-01T10:05:00.000Z',
          description: null,
          createdAt: '2025-02-01T10:00:00.000Z',
          statusUpdatedAt: '2025-02-01T10:05:00.000Z',
        },
      ],
      total: 25,
    };

    const query: ListTransfersQueryParsed = {
      page: 2,
      pageSize: 10,
      direction: 'desc',
    };

    const result = mapListTransfersOutputToDTO(output, query);

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(25);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(3);
  });

  it('deve calcular totalPages corretamente para divisão exata', () => {
    const output: ListTransfersOutput = { items: [], total: 20 };
    const query: ListTransfersQueryParsed = { page: 1, pageSize: 10, direction: 'desc' };

    const result = mapListTransfersOutputToDTO(output, query);
    expect(result.totalPages).toBe(2);
  });
});

describe('mapListTransfersQueryToInput', () => {
  it('deve converter query parsed para input do use case', () => {
    const query: ListTransfersQueryParsed = {
      page: 3,
      pageSize: 15,
      direction: 'desc',
    };

    const result = mapListTransfersQueryToInput(query, 'conta-123');

    expect(result).toEqual({
      contaId: 'conta-123',
      limit: 15,
      offset: 30, // (3-1) * 15
      status: undefined,
      search: undefined,
      operation: undefined,
      from: undefined,
      to: undefined,
      direction: 'desc',
    });
  });

  it('deve calcular offset zero para página 1', () => {
    const query: ListTransfersQueryParsed = { page: 1, pageSize: 10, direction: 'desc' };
    const result = mapListTransfersQueryToInput(query, 'conta-abc');

    expect(result.offset).toBe(0);
  });
});
