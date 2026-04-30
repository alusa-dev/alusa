import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('next-auth', () => {
  return {
    getServerSession: vi.fn(),
  };
});

const { mockPrisma } = vi.hoisted(() => {
  const usuario = {
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { nome?: string; telefone?: string | null; foto?: string | null } }) => {
      return {
        id: where.id,
        nome: data.nome ?? 'Nome',
        email: 'u@test.com',
        role: 'ADMIN',
        telefone: typeof data.telefone === 'undefined' ? '11999999999' : data.telefone,
        foto: data.foto ?? null,
      };
    }),
    findUnique: vi.fn(async () => ({ id: 'user-1', telefone: '11999999999', foto: null })),
  };

  return {
    mockPrisma: {
      usuario,
    },
  };
});

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
  prisma: mockPrisma,
}));

import { getServerSession } from 'next-auth';
import { PATCH } from '@/app/api/users/me/route';

describe('PATCH /api/users/me', () => {
  beforeEach(() => {
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: 'user-1', name: 'User', email: 'u@test.com', role: 'ADMIN' } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('atualiza nome e telefone com sucesso', async () => {
    const req = new Request('http://x/api/users/me', { method: 'PATCH', body: JSON.stringify({ name: 'Novo Nome', telefone: '(11) 99999-9999' }) });
    const res = await PATCH(req as unknown as Request);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('Novo Nome');
    expect(json.telefone).toBeDefined();
  });

  it('retorna 400 em validação inválida', async () => {
    const req = new Request('http://x/api/users/me', { method: 'PATCH', body: JSON.stringify({ name: 'a' }) });
    const res = await PATCH(req as unknown as Request);
    expect(res.status).toBe(400);
  });

  it('retorna 401 quando não autenticado', async () => {
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const req = new Request('http://x/api/users/me', { method: 'PATCH', body: JSON.stringify({ name: 'Ok' }) });
    const res = await PATCH(req as unknown as Request);
    expect(res.status).toBe(401);
  });
});
