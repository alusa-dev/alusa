import { describe, expect, it, vi } from 'vitest';

const { prismaMock, ensureAsaasCustomerForPayerMock } = vi.hoisted(() => ({
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
    },
    aluno: {
      update: vi.fn(),
    },
    responsavel: {
      update: vi.fn(),
    },
    cobranca: {
      update: vi.fn(),
    },
  },
  ensureAsaasCustomerForPayerMock: vi.fn(async () => ({ ok: true, customerId: 'cust_1' })),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

vi.mock('@alusa/lib', async () => {
  const actual = await vi.importActual<typeof import('@alusa/lib')>('@alusa/lib');

  return {
    ...actual,
  };
});

vi.mock('@alusa/finance', () => ({
  ensureAsaasCustomerForPayer: ensureAsaasCustomerForPayerMock,
  createAsaasCustomer: vi.fn(async () => ({ success: true, data: { id: 'cust_1' } })),
  createAsaasPayment: vi.fn(async () => ({ success: false, error: 'KYC_NAO_APROVADO' })),
  formatDate: vi.fn(() => '2026-01-01'),
  getAsaasPaymentDetails: vi.fn(async () => ({ pixQrCode: null })),
  KycNotApprovedError: class KycNotApprovedError extends Error {},
}));

const { POST } = await import('../route');

describe('POST /api/matriculas/[id]/gerar-pix', () => {
  it('retorna 409 e não persiste nada localmente quando KYC bloqueia', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValueOnce({ user: { id: 'u1', contaId: 'c1' } } as never);

    prismaMock.matricula.findFirst.mockResolvedValueOnce({
      id: 'm1',
      taxaIsenta: false,
      cobrancas: [{ id: 'cob_1', valor: 100, vencimento: new Date('2026-01-10'), asaasPaymentId: null }],
      responsavelFinanceiro: null,
      aluno: {
        id: 'a1',
        contaId: 'c1',
        nome: 'Aluno',
        cpf: '12345678901',
        email: 'aluno@example.com',
        telefone: '11999999999',
        asaasCustomerId: null,
        dataNasc: new Date('2000-01-01'),
        responsaveis: [],
      },
    });

    const res = await POST({} as never, { params: Promise.resolve({ id: 'm1' }) });
    expect(res.status).toBe(409);

    expect(prismaMock.aluno.update).not.toHaveBeenCalled();
    expect(prismaMock.responsavel.update).not.toHaveBeenCalled();
    expect(prismaMock.cobranca.update).not.toHaveBeenCalled();
  });
});
