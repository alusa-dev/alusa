import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mocks need to be hoisted - use vi.hoisted() for variables used in vi.mock
const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrismaCobranca = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cobranca: mockPrismaCobranca,
  },
}));

// Import after mocks
import { GET } from '@/app/api/dashboard/receita/route';

describe('GET /api/dashboard/receita (refatorado)', () => {
  const mockUser = {
    id: 'user-1',
    contaId: 'conta-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: mockUser });
  });

  it('deve usar liquidacaoStatus=DISPONIVEL para buscar receita', async () => {
    mockPrismaCobranca.findMany.mockResolvedValue([]);

    const url = new URL('http://localhost/api/dashboard/receita?contaId=conta-1');
    const request = new NextRequest(url);
    await GET(request);

    // Todas as chamadas devem usar liquidacaoStatus = DISPONIVEL
    expect(mockPrismaCobranca.findMany).toHaveBeenCalled();
    
    const calls = mockPrismaCobranca.findMany.mock.calls;
    for (const call of calls) {
      expect(call[0].where.liquidacaoStatus).toBe('DISPONIVEL');
    }
  });

  it('deve usar liquidadoEm em vez de dataPagamento/pagoEm', async () => {
    mockPrismaCobranca.findMany.mockResolvedValue([]);

    const url = new URL('http://localhost/api/dashboard/receita?contaId=conta-1');
    const request = new NextRequest(url);
    await GET(request);

    const calls = mockPrismaCobranca.findMany.mock.calls;
    for (const call of calls) {
      // Deve filtrar por liquidadoEm
      expect(call[0].where.liquidadoEm).toBeDefined();
      // NÃO deve usar dataPagamento ou pagoEm
      expect(call[0].where.dataPagamento).toBeUndefined();
      expect(call[0].where.pagoEm).toBeUndefined();
      expect(call[0].where.OR).toBeUndefined();
    }
  });

  it('deve priorizar asaasNetValue sobre asaasValue/valor', async () => {
    const cobrancas = [
      { valor: 100, asaasValue: 120, asaasNetValue: 90, liquidadoEm: new Date() },
      { valor: 200, asaasValue: 210, asaasNetValue: null, liquidadoEm: new Date() },
      { valor: 300, asaasValue: null, asaasNetValue: null, liquidadoEm: new Date() },
    ];

    mockPrismaCobranca.findMany.mockResolvedValue(cobrancas);

    const url = new URL('http://localhost/api/dashboard/receita?contaId=conta-1');
    const request = new NextRequest(url);
    const response = await GET(request);
    const json = await response.json();

    // Receita = 90 (asaasNetValue) + 210 (asaasValue fallback) + 300 (valor fallback)
    expect(json.data.receitaMes).toBe(90 + 210 + 300);
  });

  it('deve calcular série diária usando liquidadoEm', async () => {
    const hoje = new Date();
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);

    const cobrancas = [
      { valor: 100, asaasNetValue: 95, liquidadoEm: hoje },
      { valor: 200, asaasNetValue: 190, liquidadoEm: ontem },
    ];

    mockPrismaCobranca.findMany.mockResolvedValue(cobrancas);

    const url = new URL('http://localhost/api/dashboard/receita?contaId=conta-1&periodo=30d');
    const request = new NextRequest(url);
    const response = await GET(request);
    const json = await response.json();

    expect(json.data.serie).toBeDefined();
    expect(Array.isArray(json.data.serie)).toBe(true);
    expect(json.data.serieAcumulada).toBeDefined();
  });

  it('NÃO deve usar status=PAGO como único critério', async () => {
    mockPrismaCobranca.findMany.mockResolvedValue([]);

    const url = new URL('http://localhost/api/dashboard/receita?contaId=conta-1');
    const request = new NextRequest(url);
    await GET(request);

    const calls = mockPrismaCobranca.findMany.mock.calls;
    for (const call of calls) {
      // Não deve filtrar apenas por status=PAGO
      expect(call[0].where.status).toBeUndefined();
    }
  });

  it('deve retornar erro 400 se contaId não fornecido', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } });

    const url = new URL('http://localhost/api/dashboard/receita');
    const request = new NextRequest(url);
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
  });
});
