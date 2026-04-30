import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    usuario: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    conta: {
      findUnique: vi.fn(),
    },
    invite: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/users/list/route';

describe('GET /api/users/list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna 403 para usuário não admin', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', role: 'RECEPCAO' },
    } as never);

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it('retorna usuários da conta para admin autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', role: 'ADMIN' },
    } as never);
    prismaMock.usuario.findUnique.mockResolvedValueOnce({ contaId: 'conta-1' });
    prismaMock.conta.findUnique.mockResolvedValueOnce({ ownerUserId: 'owner-1' });
    prismaMock.usuario.findMany.mockResolvedValueOnce([
      {
        id: 'user-1',
        nome: 'Admin',
        email: 'admin@example.com',
        role: 'ADMIN',
        status: 'ATIVO',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
      {
        id: 'user-2',
        nome: 'Removido',
        email: 'removed-user+user-2@alusa.invalid',
        role: 'RECEPCAO',
        status: 'INATIVO',
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
      },
    ]);
    prismaMock.invite.findMany.mockResolvedValueOnce([{ acceptedByUserId: 'user-1' }]);

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({
      id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'ADMIN',
      createdVia: 'INVITE',
      isCurrentUser: true,
      isOwner: false,
      permissions: {
        canEdit: true,
        canToggleStatus: false,
        canDelete: false,
      },
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
