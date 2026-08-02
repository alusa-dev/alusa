import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionUserMock = vi.hoisted(() => vi.fn());
const avatarMock = vi.hoisted(() => ({
  prepareAvatarFile: vi.fn(),
  replaceCurrentAvatar: vi.fn(),
  removeCurrentAvatar: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSessionUser: getSessionUserMock }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: () => '127.0.0.1',
  rateLimit: () => ({ ok: true }),
}));
vi.mock('@/features/account/server/avatar-service', () => {
  class AvatarServiceError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(
      message: string,
      status: number,
      code: string,
    ) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    AvatarServiceError,
    prepareAvatarFile: avatarMock.prepareAvatarFile,
    replaceCurrentAvatar: avatarMock.replaceCurrentAvatar,
    removeCurrentAvatar: avatarMock.removeCurrentAvatar,
  };
});

import { DELETE, POST } from '@/app/api/users/me/avatar/route';

describe('/api/users/me/avatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserMock.mockResolvedValue({ id: 'user-1', contaId: 'conta-1', role: 'ADMIN' });
    avatarMock.prepareAvatarFile.mockResolvedValue({ bytes: new Uint8Array([1]), extension: '.jpg', mimeType: 'image/jpeg' });
    avatarMock.replaceCurrentAvatar.mockResolvedValue({ url: '/uploads/avatar.jpg' });
    avatarMock.removeCurrentAvatar.mockResolvedValue({ url: null });
  });

  it('exige autenticação antes de processar o arquivo', async () => {
    getSessionUserMock.mockResolvedValueOnce(null);
    const response = await POST(new Request('http://localhost/api/users/me/avatar', { method: 'POST' }));

    expect(response.status).toBe(401);
    expect(avatarMock.prepareAvatarFile).not.toHaveBeenCalled();
  });

  it('propaga usuário e conta ativa para a troca do avatar', async () => {
    const form = new FormData();
    form.append('file', new File([Uint8Array.from([1])], 'avatar.jpg', { type: 'image/jpeg' }));
    const response = await POST({
      headers: new Headers(),
      formData: async () => form,
    } as Request);

    expect(response.status).toBe(200);
    expect(avatarMock.replaceCurrentAvatar).toHaveBeenCalledWith(
      { userId: 'user-1', contaId: 'conta-1' },
      expect.any(Object),
      expect.any(String),
    );
  });

  it('remove a foto dentro do mesmo contexto autenticado', async () => {
    const response = await DELETE(new Request('http://localhost/api/users/me/avatar', {
      method: 'DELETE',
    }));

    expect(response.status).toBe(200);
    expect(avatarMock.removeCurrentAvatar).toHaveBeenCalledWith(
      { userId: 'user-1', contaId: 'conta-1' },
      expect.any(String),
    );
  });
});
