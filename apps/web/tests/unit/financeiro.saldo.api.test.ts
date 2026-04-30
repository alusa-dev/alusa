import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks need to be hoisted
const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockGetBalance = vi.hoisted(() => vi.fn());
const mockPrismaAggregate = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  getBalance: (params: { contaId: string }) => mockGetBalance(params),
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    cobranca: {
      aggregate: () => mockPrismaAggregate(),
    },
  },
}));

// Import after mocks
import { GET } from '@/app/api/financeiro/saldo/route';

// Helper para criar Request com URL
function createRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/financeiro/saldo');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Request(url.toString());
}

describe('GET /api/financeiro/saldo', () => {
  const mockUser = {
    id: 'user-1',
    contaId: 'conta-1',
    role: 'ADMIN',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: mockUser });
    mockGetBalance.mockResolvedValue({ success: true, data: { balance: 0 } });
    mockPrismaAggregate.mockResolvedValue({ _sum: { asaasNetValue: null } });
  });

  it('deve retornar 401 se usuário não autenticado', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(createRequest());
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error.code).toBe('NAO_AUTENTICADO');
  });

  it('deve retornar 403 para roles não permitidos', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { ...mockUser, role: 'ALUNO' },
    });

    const response = await GET(createRequest());
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error.code).toBe('SEM_PERMISSAO');
  });

  it('deve retornar saldo Asaas quando fonte=asaas (default)', async () => {
    mockGetBalance.mockResolvedValue({ success: true, data: { balance: 1250.75 } });

    const response = await GET(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.saldoDisponivel).toBe(1250.75);
    expect(json.data.fonte).toBe('asaas');
    expect(json.data.consultadoEm).toBeDefined();
  });

  it('deve chamar getBalance com contaId correta', async () => {
    mockGetBalance.mockResolvedValue({ success: true, data: { balance: 0 } });

    await GET(createRequest());

    expect(mockGetBalance).toHaveBeenCalledWith({ contaId: 'conta-1' });
  });

  it('deve usar fallback local se Asaas indisponível', async () => {
    mockGetBalance.mockResolvedValue({ success: false, error: 'ERRO_AO_OBTER_SALDO' });
    mockPrismaAggregate.mockResolvedValue({ _sum: { asaasNetValue: { toNumber: () => 500 } } });

    const response = await GET(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.saldoDisponivel).toBe(500);
    expect(json.data.fonte).toBe('local');
  });

  it('deve retornar saldo local quando fonte=local', async () => {
    mockPrismaAggregate.mockResolvedValue({ _sum: { asaasNetValue: { toNumber: () => 750 } } });

    const response = await GET(createRequest({ fonte: 'local' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.saldoDisponivel).toBe(750);
    expect(json.data.fonte).toBe('local');
    // Não deve chamar Asaas quando fonte=local
    expect(mockGetBalance).not.toHaveBeenCalled();
  });

  it('deve permitir acesso para role FINANCEIRO', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { ...mockUser, role: 'FINANCEIRO' },
    });
    mockGetBalance.mockResolvedValue({ success: true, data: { balance: 500 } });

    const response = await GET(createRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.saldoDisponivel).toBe(500);
  });

  it('deve retornar 0 quando não há cobranças disponíveis (local)', async () => {
    mockPrismaAggregate.mockResolvedValue({ _sum: { asaasNetValue: null } });

    const response = await GET(createRequest({ fonte: 'local' }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.saldoDisponivel).toBe(0);
  });
});
