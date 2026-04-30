import { describe, it, expect } from 'vitest';
import {
  resolveCategory,
  resolveSign,
  mapAsaasTransactionToLedgerEntry,
  resolveType,
  resolveStatus,
  resolveFee,
  mapToLedgerEntry,
} from '../ledger.mapper';

describe('resolveCategory', () => {
  it('deve mapear PAYMENT_RECEIVED corretamente', () => {
    expect(resolveCategory('PAYMENT_RECEIVED')).toBe('PAYMENT_RECEIVED');
  });

  it('deve mapear PARTIAL_PAYMENT para PAYMENT_RECEIVED', () => {
    expect(resolveCategory('PARTIAL_PAYMENT')).toBe('PAYMENT_RECEIVED');
  });

  it('deve mapear PAYMENT_FEE para PAYMENT_FEE', () => {
    expect(resolveCategory('PAYMENT_FEE')).toBe('PAYMENT_FEE');
  });

  it('deve mapear REVERSAL para PAYMENT_REFUND', () => {
    expect(resolveCategory('REVERSAL')).toBe('PAYMENT_REFUND');
  });

  it('deve mapear TRANSFER para TRANSFER_SENT', () => {
    expect(resolveCategory('TRANSFER')).toBe('TRANSFER_SENT');
  });

  it('deve mapear PIX_TRANSACTION_DEBIT para PIX_DEBIT', () => {
    expect(resolveCategory('PIX_TRANSACTION_DEBIT')).toBe('PIX_DEBIT');
  });

  it('deve mapear PIX_TRANSACTION_CREDIT para PIX_CREDIT', () => {
    expect(resolveCategory('PIX_TRANSACTION_CREDIT')).toBe('PIX_CREDIT');
  });

  it('deve retornar OTHER para tipo desconhecido', () => {
    expect(resolveCategory('FUTURE_UNKNOWN_TYPE')).toBe('OTHER');
  });
});

describe('resolveSign', () => {
  it('deve retornar CREDIT para valor positivo', () => {
    expect(resolveSign(100)).toBe('CREDIT');
  });

  it('deve retornar CREDIT para valor zero', () => {
    expect(resolveSign(0)).toBe('CREDIT');
  });

  it('deve retornar DEBIT para valor negativo', () => {
    expect(resolveSign(-50)).toBe('DEBIT');
  });
});

describe('mapAsaasTransactionToLedgerEntry', () => {
  it('deve mapear transação de pagamento recebido', () => {
    const result = mapAsaasTransactionToLedgerEntry({
      id: 'ft_1',
      value: 100.5,
      balance: 500,
      type: 'PAYMENT_RECEIVED',
      date: '2025-03-01',
      description: 'Pagamento recebido',
      paymentId: 'pay_1',
      splitId: 'split_1',
      transferId: null,
      anticipationId: null,
      billId: null,
      invoiceId: null,
      paymentDunningId: null,
      creditBureauReportId: null,
    });

    expect(result).toEqual({
      id: 'ft_1',
      date: '2025-03-01',
      description: 'Pagamento recebido',
      asaasType: 'PAYMENT_RECEIVED',
      category: 'PAYMENT_RECEIVED',
      sign: 'CREDIT',
      value: 100.5,
      balance: 500,
      paymentId: 'pay_1',
      splitId: 'split_1',
      transferId: null,
      anticipationId: null,
      billId: null,
      invoiceId: null,
      paymentDunningId: null,
      creditBureauReportId: null,
    });
  });

  it('deve mapear taxa como DEBIT', () => {
    const result = mapAsaasTransactionToLedgerEntry({
      id: 'ft_2',
      value: -3.49,
      balance: 496.51,
      type: 'PAYMENT_FEE',
      date: '2025-03-01',
      description: 'Taxa de cobrança',
      paymentId: 'pay_1',
    });

    expect(result.sign).toBe('DEBIT');
    expect(result.category).toBe('PAYMENT_FEE');
    expect(result.transferId).toBeNull();
  });

  it('deve tratar paymentId undefined como null', () => {
    const result = mapAsaasTransactionToLedgerEntry({
      id: 'ft_3',
      value: 50,
      balance: 550,
      type: 'PROMOTIONAL_CODE_CREDIT',
      date: '2025-03-01',
      description: 'Crédito promocional',
    });

    expect(result.paymentId).toBeNull();
    expect(result.splitId).toBeNull();
    expect(result.transferId).toBeNull();
    expect(result.category).toBe('PROMOTIONAL_CREDIT');
  });

  it('deve mapear identificadores auxiliares do recurso oficial', () => {
    const result = mapAsaasTransactionToLedgerEntry({
      id: 'ft_4',
      value: -25,
      balance: 475,
      type: 'BILL_PAYMENT',
      date: '2025-03-02',
      description: 'Pagamento de conta',
      billId: 'bill_1',
      invoiceId: 'inv_1',
      paymentDunningId: 'dunning_1',
      creditBureauReportId: 'serasa_1',
      anticipationId: 'ant_1',
    });

    expect(result.billId).toBe('bill_1');
    expect(result.invoiceId).toBe('inv_1');
    expect(result.paymentDunningId).toBe('dunning_1');
    expect(result.creditBureauReportId).toBe('serasa_1');
    expect(result.anticipationId).toBe('ant_1');
    expect(result.category).toBe('BILL_PAYMENT');
  });
});

// ─── Testes das novas funções canônicas (resolveType, resolveStatus, resolveFee, mapToLedgerEntry) ───

describe('resolveType', () => {
  it('deve mapear PAYMENT_RECEIVED → RECEITA', () => {
    expect(resolveType('PAYMENT_RECEIVED')).toBe('RECEITA');
  });

  it('deve mapear PIX_CREDIT → RECEITA', () => {
    expect(resolveType('PIX_CREDIT')).toBe('RECEITA');
  });

  it('deve mapear PAYMENT_FEE → TAXA', () => {
    expect(resolveType('PAYMENT_FEE')).toBe('TAXA');
  });

  it('deve mapear TRANSFER_FEE → TAXA', () => {
    expect(resolveType('TRANSFER_FEE')).toBe('TAXA');
  });

  it('deve mapear PIX_FEE → TAXA', () => {
    expect(resolveType('PIX_FEE')).toBe('TAXA');
  });

  it('deve mapear INVOICE_FEE → TAXA', () => {
    expect(resolveType('INVOICE_FEE')).toBe('TAXA');
  });

  it('deve mapear PAYMENT_REFUND → ESTORNO', () => {
    expect(resolveType('PAYMENT_REFUND')).toBe('ESTORNO');
  });

  it('deve mapear CHARGEBACK → ESTORNO', () => {
    expect(resolveType('CHARGEBACK')).toBe('ESTORNO');
  });

  it('deve mapear TRANSFER_SENT → TRANSFERENCIA', () => {
    expect(resolveType('TRANSFER_SENT')).toBe('TRANSFERENCIA');
  });

  it('deve mapear INTERNAL_TRANSFER → TRANSFERENCIA', () => {
    expect(resolveType('INTERNAL_TRANSFER')).toBe('TRANSFERENCIA');
  });

  it('deve mapear ANTICIPATION → ANTECIPACAO', () => {
    expect(resolveType('ANTICIPATION')).toBe('ANTECIPACAO');
  });

  it('deve mapear CUSTODY → AJUSTE', () => {
    expect(resolveType('CUSTODY')).toBe('AJUSTE');
  });

  it('deve mapear OTHER → AJUSTE', () => {
    expect(resolveType('OTHER')).toBe('AJUSTE');
  });
});

describe('resolveStatus', () => {
  it('deve retornar CONFIRMADO para PAYMENT_RECEIVED', () => {
    expect(resolveStatus('PAYMENT_RECEIVED')).toBe('CONFIRMADO');
  });

  it('deve retornar CANCELADO para REVERSAL', () => {
    expect(resolveStatus('PAYMENT_REVERSAL')).toBe('CANCELADO');
  });

  it('deve retornar CANCELADO para CANCELLED', () => {
    expect(resolveStatus('BILL_PAYMENT_CANCELLED')).toBe('CANCELADO');
  });

  it('deve retornar CANCELADO para REFUND', () => {
    expect(resolveStatus('PIX_TRANSACTION_DEBIT_REFUND')).toBe('CANCELADO');
  });

  it('deve retornar CANCELADO para CANCELLATION', () => {
    expect(resolveStatus('REFUND_REQUEST_CANCELLED')).toBe('CANCELADO');
  });

  it('deve retornar CONFIRMADO para TRANSFER', () => {
    expect(resolveStatus('TRANSFER')).toBe('CONFIRMADO');
  });
});

describe('resolveFee', () => {
  it('deve extrair fee para PAYMENT_FEE', () => {
    expect(resolveFee({ id: '1', value: -3.49, balance: 0, type: 'PAYMENT_FEE', date: '2025-01-01', description: '' })).toBe(3.49);
  });

  it('deve extrair fee para TRANSFER_FEE', () => {
    expect(resolveFee({ id: '1', value: -1.0, balance: 0, type: 'TRANSFER_FEE', date: '2025-01-01', description: '' })).toBe(1.0);
  });

  it('deve extrair fee para PIX_TRANSACTION_DEBIT_FEE', () => {
    expect(resolveFee({ id: '1', value: -0.5, balance: 0, type: 'PIX_TRANSACTION_DEBIT_FEE', date: '2025-01-01', description: '' })).toBe(0.5);
  });

  it('deve retornar 0 para PAYMENT_RECEIVED (não é taxa)', () => {
    expect(resolveFee({ id: '1', value: 100, balance: 100, type: 'PAYMENT_RECEIVED', date: '2025-01-01', description: '' })).toBe(0);
  });

  it('deve retornar 0 para TRANSFER (não é taxa)', () => {
    expect(resolveFee({ id: '1', value: -50, balance: 50, type: 'TRANSFER', date: '2025-01-01', description: '' })).toBe(0);
  });
});

describe('mapToLedgerEntry', () => {
  const baseRaw = {
    id: 'ft_100',
    value: 100,
    balance: 500,
    type: 'PAYMENT_RECEIVED',
    date: '2025-06-01',
    description: 'Mensalidade João',
    paymentId: 'pay_abc',
  };

  it('deve mapear pagamento recebido corretamente', () => {
    const entry = mapToLedgerEntry(baseRaw);

    expect(entry.id).toBe('ft_100');
    expect(entry.type).toBe('RECEITA');
    expect(entry.status).toBe('CONFIRMADO');
    expect(entry.grossValue).toBe(100);
    expect(entry.fee).toBe(0);
    expect(entry.netValue).toBe(100);
    expect(entry.balanceAfter).toBe(500);
    expect(entry.paymentId).toBe('pay_abc');
    expect(entry.source).toBe('ASAAS');
    expect(entry.metadata?.asaasType).toBe('PAYMENT_RECEIVED');
    expect(entry.metadata?.rawCategory).toBe('PAYMENT_RECEIVED');
  });

  it('deve mapear taxa com netValue 0', () => {
    const entry = mapToLedgerEntry({
      id: 'ft_fee',
      value: -3.49,
      balance: 496.51,
      type: 'PAYMENT_FEE',
      date: '2025-06-01',
      description: 'Taxa cobrança',
      paymentId: 'pay_abc',
    });

    expect(entry.type).toBe('TAXA');
    expect(entry.fee).toBe(3.49);
    expect(entry.netValue).toBe(0);
    expect(entry.grossValue).toBe(-3.49);
  });

  it('deve mapear estorno', () => {
    const entry = mapToLedgerEntry({
      id: 'ft_refund',
      value: -100,
      balance: 400,
      type: 'REVERSAL',
      date: '2025-06-02',
      description: 'Estorno pagamento',
    });

    expect(entry.type).toBe('ESTORNO');
    expect(entry.status).toBe('CANCELADO');
    expect(entry.netValue).toBe(-100);
    expect(entry.fee).toBe(0);
  });

  it('deve setar transferId quando presente', () => {
    const entry = mapToLedgerEntry({
      id: 'ft_transfer',
      value: -200,
      balance: 300,
      type: 'TRANSFER',
      date: '2025-06-03',
      description: 'Transferência',
      transferId: 'tr_123',
    });

    expect(entry.type).toBe('TRANSFERENCIA');
    expect(entry.transferId).toBe('tr_123');
    expect(entry.paymentId).toBeNull();
  });

  it('deve mapear tipo desconhecido como AJUSTE', () => {
    const entry = mapToLedgerEntry({
      id: 'ft_unknown',
      value: 10,
      balance: 310,
      type: 'SOME_FUTURE_TYPE_FROM_ASAAS',
      date: '2025-06-04',
      description: 'Tipo novo',
    });

    expect(entry.type).toBe('AJUSTE');
    expect(entry.status).toBe('CONFIRMADO');
  });
});
