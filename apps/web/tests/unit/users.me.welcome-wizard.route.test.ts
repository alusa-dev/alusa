import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getServerSessionMock, resolveUserIdMock, prismaMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  resolveUserIdMock: vi.fn(),
  prismaMock: {
    usuario: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: prismaMock,
}));

vi.mock('@/app/api/users/me/helpers', () => ({
  resolveUserId: resolveUserIdMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

import { GET, PATCH } from '@/app/api/users/me/welcome-wizard/route';

describe('/api/users/me/welcome-wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } });
    resolveUserIdMock.mockResolvedValue('user-1');
  });

  it('retorna shouldShow=true para usuário que ainda não viu o wizard', async () => {
    prismaMock.usuario.findUnique.mockResolvedValueOnce({
      welcomeWizardSeenAt: null,
    });

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      shouldShow: true,
      seenAt: null,
    });
  });

  it('marca o wizard como visto no PATCH', async () => {
    const seenAt = new Date('2026-05-17T20:00:00.000Z');
    prismaMock.usuario.update.mockResolvedValueOnce({
      welcomeWizardSeenAt: seenAt,
    });

    const response = await PATCH();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(prismaMock.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: { welcomeWizardSeenAt: expect.any(Date) },
      }),
    );
    expect(json).toMatchObject({
      shouldShow: false,
      seenAt: seenAt.toISOString(),
    });
  });
});