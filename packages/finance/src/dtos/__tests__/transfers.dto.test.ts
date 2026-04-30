import { describe, it, expect } from 'vitest';
import {
  requestWithdrawDTOSchema,
  requestWithdrawResultDTOSchema,
  listTransfersQueryDTOSchema,
  listTransfersResultDTOSchema,
} from '../index';

describe('requestWithdrawDTOSchema', () => {
  const validPix = {
    amount: '150.00',
    destination: {
      type: 'PIX' as const,
      pixAddressKey: '12345678901',
      pixAddressKeyType: 'CPF' as const,
      saveRecipient: true,
    },
  };

  const validBankAccount = {
    amount: '1000.00',
    destination: {
      type: 'BANK_ACCOUNT' as const,
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

  it('deve aceitar saque via PIX válido', () => {
    const result = requestWithdrawDTOSchema.safeParse(validPix);
    expect(result.success).toBe(true);
  });

  it('deve aceitar saque via conta bancária válido', () => {
    const result = requestWithdrawDTOSchema.safeParse(validBankAccount);
    expect(result.success).toBe(true);
  });

  it('deve aceitar amount com ou sem casas decimais', () => {
    // O regex aceita ambos formatos: "150" ou "150.00"
    const resultWithDecimals = requestWithdrawDTOSchema.safeParse({
      ...validPix,
      amount: '150.00',
    });
    expect(resultWithDecimals.success).toBe(true);

    const resultWithoutDecimals = requestWithdrawDTOSchema.safeParse({
      ...validPix,
      amount: '150',
    });
    expect(resultWithoutDecimals.success).toBe(true);
  });

  it('deve rejeitar amount negativo', () => {
    const result = requestWithdrawDTOSchema.safeParse({
      ...validPix,
      amount: '-150.00',
    });
    expect(result.success).toBe(false);
  });

  it('deve rejeitar destination sem tipo', () => {
    const result = requestWithdrawDTOSchema.safeParse({
      amount: '150.00',
      destination: { pixAddressKey: '123' },
    });
    expect(result.success).toBe(false);
  });

  it('deve rejeitar scheduleDate com formato inválido', () => {
    const result = requestWithdrawDTOSchema.safeParse({
      ...validPix,
      scheduleDate: '15/02/2025',
    });
    expect(result.success).toBe(false);
  });

  it('deve aceitar sem description e scheduleDate', () => {
    const result = requestWithdrawDTOSchema.safeParse(validPix);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.scheduleDate).toBeUndefined();
    }
  });
});

describe('requestWithdrawResultDTOSchema', () => {
  const validResult = {
    id: 'tr-123',
    externalReference: 'asaas_tr_abc',
    status: 'PENDING',
    amount: '150.00',
    createdAt: '2025-02-01T10:00:00.000Z',
  };

  it('deve validar resposta correta', () => {
    const result = requestWithdrawResultDTOSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it('deve rejeitar status inválido', () => {
    const result = requestWithdrawResultDTOSchema.safeParse({
      ...validResult,
      status: 'INVALID_STATUS',
    });
    expect(result.success).toBe(false);
  });
});

describe('listTransfersQueryDTOSchema', () => {
  it('deve usar defaults quando vazio', () => {
    const result = listTransfersQueryDTOSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(10);
    }
  });

  it('deve converter page/pageSize de string para number', () => {
    const result = listTransfersQueryDTOSchema.safeParse({
      page: '3',
      pageSize: '25',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it('deve limitar pageSize máximo em 100 via transform', () => {
    const result = listTransfersQueryDTOSchema.safeParse({
      pageSize: '200',
    });
    // O schema aceita mas transforma para max 100
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe(100);
    }
  });

  it('deve aceitar status opcional', () => {
    const result = listTransfersQueryDTOSchema.safeParse({
      status: 'PENDING',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('PENDING');
    }
  });

  it('deve aceitar busca, operacao e direction', () => {
    const result = listTransfersQueryDTOSchema.safeParse({
      search: 'Elaine',
      operation: 'PIX',
      direction: 'asc',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.search).toBe('Elaine');
      expect(result.data.operation).toBe('PIX');
      expect(result.data.direction).toBe('asc');
    }
  });

  it('deve aceitar from/to em formato YYYY-MM-DD', () => {
    const result = listTransfersQueryDTOSchema.safeParse({
      from: '2025-01-01',
      to: '2025-01-31',
    });
    expect(result.success).toBe(true);
  });
});

describe('listTransfersResultDTOSchema', () => {
  const validResult = {
    items: [
      {
        id: 'tr-1',
        externalReference: 'asaas_tr_1',
        amount: '100.00',
        feeAmount: null,
        netAmount: '100.00',
        status: 'DONE',
        operation: 'TED',
        recipientName: 'Elaine Costa',
        cpfCnpj: '***.197.862-**',
        bankName: 'Banco 260',
        description: null,
        scheduleDate: null,
        transferDate: '2025-02-01T10:05:00.000Z',
        createdAt: '2025-02-01T10:00:00.000Z',
        statusUpdatedAt: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  };

  it('deve validar resultado de listagem correto', () => {
    const result = listTransfersResultDTOSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it('deve aceitar lista vazia', () => {
    const result = listTransfersResultDTOSchema.safeParse({
      ...validResult,
      items: [],
      total: 0,
      totalPages: 0,
    });
    expect(result.success).toBe(true);
  });
});
