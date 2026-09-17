import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveTenantSessionMock = vi.hoisted(() => vi.fn());
const deleteStorageObjectMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: resolveTenantSessionMock }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: () => '127.0.0.1',
  rateLimit: () => ({ ok: true }),
}));
vi.mock('@/lib/prisma', () => ({
  default: { usuario: { findFirst: vi.fn() } },
}));
vi.mock('@/lib/r2-storage', () => ({
  deleteStorageObject: deleteStorageObjectMock,
  isR2Configured: vi.fn(() => true),
  putStorageObject: vi.fn(),
  storageKeyFromUrl: (url: string) => {
    const prefix = '/api/files/';
    return url.startsWith(prefix) ? decodeURI(url.slice(prefix.length)) : null;
  },
  storageUrlForKey: (key: string) => `/api/files/${key}`,
}));

import { DELETE } from '@/app/api/upload/route';

describe('DELETE /api/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantSessionMock.mockResolvedValue({ ok: true, userId: 'user-1', contaId: 'conta-1', role: 'ADMIN' });
  });

  it('não permite excluir objeto de outro recurso com nome pertencente à sessão', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/upload', {
        method: 'DELETE',
        body: JSON.stringify({ url: '/api/files/uploads/produtos/conta-1-user-1-product.png' }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(response.status).toBe(400);
    expect(deleteStorageObjectMock).not.toHaveBeenCalled();
  });
});
