import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getServerSessionMock,
  createAsaasPaymentMock,
  getAsaasPaymentDetailsMock,
  materializeSubscriptionPaymentForChargeMock,
  prismaMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  createAsaasPaymentMock: vi.fn(),
  getAsaasPaymentDetailsMock: vi.fn(),
  materializeSubscriptionPaymentForChargeMock: vi.fn(),
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
    },
    cobranca: {
      update: vi.fn(),
    },
  },
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@alusa/finance', () => ({
  createAsaasPayment: createAsaasPaymentMock,
  getAsaasPaymentDetails: getAsaasPaymentDetailsMock,
  formatDate: vi.fn(() => '2026-01-01'),
  mapAsaasPaymentStatusToCobranca: vi.fn(() => 'A_VENCER'),
  KycNotApprovedError: class KycNotApprovedError extends Error {},
}));

vi.mock('@alusa/lib', () => ({
  ensureAsaasCustomerForPayer: vi.fn(),
  calcIdade: vi.fn(() => 25),
}));

vi.mock('@/src/server/matriculas/subscription-payment-materialization', () => ({
  materializeSubscriptionPaymentForCharge: materializeSubscriptionPaymentForChargeMock,
}));

const { POST } = await import('../route');

describe('POST /api/matriculas/[id]/reenviar-cobranca', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    });
  });

  it('retorna 409 e não persiste nada localmente quando KYC bloqueia na criação do payment', async () => {
    createAsaasPaymentMock.mockResolvedValueOnce({ success: false, error: 'KYC_NAO_APROVADO' });

    prismaMock.matricula.findFirst.mockResolvedValueOnce({
      id: 'm1',
      asaasSubscriptionId: null,
      cobrancas: [
        {
          id: 'cob_1',
          tipo: 'TAXA_MATRICULA',
          status: 'PENDENTE',
          asaasPaymentId: null,
          formaPagamento: 'PIX',
          valor: 100,
          vencimento: new Date('2026-01-10'),
          descricao: 'Teste',
        },
      ],
      aluno: {
        id: 'a1',
        nome: 'Aluno',
        email: 'aluno@example.com',
        cpf: '12345678901',
        telefone: '11999999999',
        dataNasc: new Date('2000-01-01'),
        asaasCustomerId: 'cust_1',
        responsaveis: [],
      },
      responsavelFinanceiro: null,
    });

    const res = await POST({} as never, { params: { id: 'm1' } });
    expect(res.status).toBe(409);
    expect(materializeSubscriptionPaymentForChargeMock).not.toHaveBeenCalled();
    expect(prismaMock.cobranca.update).not.toHaveBeenCalled();
  });

  it('materializa a mensalidade da assinatura antes de tentar criar cobrança avulsa', async () => {
    materializeSubscriptionPaymentForChargeMock.mockResolvedValueOnce({
      found: true,
      matchedBy: 'EXACT_DUE_DATE',
      linkedChargeId: 'cob_1',
      updated: true,
      payment: {
        id: 'pay_sub_1',
        status: 'PENDING',
        dueDate: '2026-01-10',
        value: 75,
        netValue: 73.5,
        invoiceUrl: 'https://asaas.test/invoice/pay_sub_1',
        bankSlipUrl: null,
      },
    });
    getAsaasPaymentDetailsMock.mockResolvedValueOnce({
      payment: {
        id: 'pay_sub_1',
        status: 'PENDING',
        invoiceUrl: 'https://asaas.test/invoice/pay_sub_1',
        bankSlipUrl: null,
      },
      pixQrCode: null,
    });

    prismaMock.matricula.findFirst.mockResolvedValueOnce({
      id: 'm1',
      asaasSubscriptionId: 'sub_1',
      cobrancas: [
        {
          id: 'cob_1',
          tipo: 'MENSALIDADE',
          status: 'PENDENTE',
          asaasPaymentId: null,
          formaPagamento: 'BOLETO',
          valor: 75,
          vencimento: new Date('2026-01-10'),
          descricao: 'Mensalidade',
        },
      ],
      aluno: {
        id: 'a1',
        nome: 'Aluno',
        email: 'aluno@example.com',
        cpf: '12345678901',
        telefone: '11999999999',
        dataNasc: new Date('2000-01-01'),
        asaasCustomerId: 'cust_1',
        responsaveis: [],
      },
      responsavelFinanceiro: null,
    });

    const res = await POST({} as never, { params: { id: 'm1' } });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(materializeSubscriptionPaymentForChargeMock).toHaveBeenCalledOnce();
    expect(createAsaasPaymentMock).not.toHaveBeenCalled();
    expect(data.asaasPaymentId).toBe('pay_sub_1');
    expect(data.invoiceUrl).toBe('https://asaas.test/invoice/pay_sub_1');
  });
});
