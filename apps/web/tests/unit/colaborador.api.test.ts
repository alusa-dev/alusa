import { describe, it, expect, vi } from 'vitest';
import { POST as handler } from '@/app/api/colaboradores/route';
import { NextRequest } from 'next/server';

const { createColabMock, updateColabMock, normalizeAvatarUploadMock, discardAvatarUploadMock } = vi.hoisted(() => ({
  createColabMock: vi.fn(),
  updateColabMock: vi.fn(),
  normalizeAvatarUploadMock: vi.fn(),
  discardAvatarUploadMock: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
  }),
}));

vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));

vi.mock('@/src/server/platform-billing/capacity', () => ({
  assertPlatformAccessForConta: vi.fn(),
}));
vi.mock('../../../../packages/lib/src/server/services/colaborador-service', () => ({
  create: createColabMock,
  update: updateColabMock,
}));
vi.mock('@/src/server/media/avatar-storage.service', () => ({
  normalizeAvatarUpload: normalizeAvatarUploadMock,
  discardAvatarUpload: discardAvatarUploadMock,
}));

describe('API Colaboradores', () => {
  it('retorna 400 para payload inválido', async () => {
  const req = new NextRequest('http://localhost/api/colaboradores', { method: 'POST', body: JSON.stringify({}) });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it('keeps employee creation successful and reports a photo upload failure', async () => {
    createColabMock.mockResolvedValueOnce({ id: 'employee-1', nome: 'Ana Souza', foto: null });
    normalizeAvatarUploadMock.mockRejectedValueOnce(new Error('quota unavailable'));
    discardAvatarUploadMock.mockResolvedValue(undefined);

    const req = new NextRequest('http://localhost/api/colaboradores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Ana Souza',
        enderecoCep: '12345-678',
        cargo: 'OUTRO',
        dataNasc: '01/01/1990',
        email: 'ana@example.com',
        telefone1: '11987654321',
        foto: 'data:image/jpeg;base64,YQ==',
      }),
    });

    const response = await handler(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe('employee-1');
    expect(body.photoUploadWarning).toMatch(/Colaborador criado/);
    expect(updateColabMock).not.toHaveBeenCalled();
  });
});
