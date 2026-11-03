import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

const { prismaMock, removeManagedUserAccessMock } = vi.hoisted(() => ({
  prismaMock: {
    usuario: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    usuarioConta: { findUnique: vi.fn(), updateMany: vi.fn() },
    conta: {
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
  removeManagedUserAccessMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

vi.mock('@/features/users/managed-user-access', () => ({
  removeManagedUserAccess: removeManagedUserAccessMock,
}));

import { getServerSession } from 'next-auth';
import { DELETE, PATCH } from '@/app/api/users/[id]/route';

describe('/api/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', contaId: 'conta-1' },
    } as never);
    prismaMock.usuario.findUnique.mockResolvedValue({ contaId: 'conta-1', id: 'admin-1' });
    prismaMock.usuarioConta.findUnique.mockResolvedValue(null);
  });

  it('bloqueia remoção do próprio acesso', async () => {
    const response = await DELETE(new Request('http://x/api/users/admin-1', { method: 'DELETE' }), {
      params: { id: 'admin-1' },
    });

    expect(response.status).toBe(400);
    expect(removeManagedUserAccessMock).not.toHaveBeenCalled();
  });

  it('suspende somente o acesso do usuário alvo na conta autenticada', async () => {
    prismaMock.usuarioConta.findUnique.mockResolvedValueOnce({
      role: 'RECEPCAO', status: 'ATIVO', usuario: { id: 'user-2', nome: 'User', email: 'user@example.com', status: 'ATIVO' },
    });
    prismaMock.conta.findUnique.mockResolvedValueOnce({ ownerUserId: 'owner-1' });
    removeManagedUserAccessMock.mockResolvedValueOnce({
      id: 'user-2',
      hard: false,
      alreadyRemoved: false,
    });

    const response = await DELETE(new Request('http://x/api/users/user-2', { method: 'DELETE' }), {
      params: { id: 'user-2' },
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, id: 'user-2', hard: false });
    expect(removeManagedUserAccessMock).toHaveBeenCalledWith({
      userId: 'user-2',
      contaId: 'conta-1',
      actorId: 'admin-1',
      reason: undefined,
    });
  });

  it('bloqueia suspensão do owner', async () => {
    prismaMock.usuarioConta.findUnique.mockResolvedValueOnce({
      role: 'ADMIN', status: 'ATIVO', usuario: { id: 'owner-1', nome: 'Owner', email: 'owner@example.com', status: 'ATIVO' },
    });
    prismaMock.conta.findUnique.mockResolvedValueOnce({ ownerUserId: 'owner-1' });

    const response = await DELETE(new Request('http://x/api/users/owner-1', { method: 'DELETE' }), {
      params: { id: 'owner-1' },
    });

    expect(response.status).toBe(403);
    expect(removeManagedUserAccessMock).not.toHaveBeenCalled();
  });

  it('não localiza usuário que não pertence à conta da sessão', async () => {
    prismaMock.usuarioConta.findUnique.mockResolvedValueOnce(null);

    const response = await DELETE(new Request('http://x/api/users/user-from-other-school', { method: 'DELETE' }), {
      params: { id: 'user-from-other-school' },
    });

    expect(response.status).toBe(404);
    expect(removeManagedUserAccessMock).not.toHaveBeenCalled();
  });

  it('bloqueia auto-inativação via PATCH', async () => {
    prismaMock.usuarioConta.findUnique.mockResolvedValueOnce({
      role: 'ADMIN', status: 'ATIVO', usuario: {
        id: 'admin-1', nome: 'Admin', email: 'admin@example.com', status: 'ATIVO',
      },
    });

    const response = await PATCH(
      new Request('http://x/api/users/admin-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INATIVO' }),
      }),
      { params: { id: 'admin-1' } },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toContain('próprio status');
    expect(prismaMock.usuario.updateMany).not.toHaveBeenCalled();
  });
});
