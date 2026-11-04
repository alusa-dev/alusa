import { beforeEach, describe, it, expect, vi } from 'vitest';
import { POST as handler } from '@/app/api/colaboradores/route';
import { PATCH as patchHandler } from '@/app/api/colaboradores/[id]/route';
import { NextRequest } from 'next/server';

const { createColabMock, updateColabMock, findExactRetryMock, normalizeAvatarUploadMock, discardAvatarUploadMock, inviteEmployeeAccessMock, getColaboradorMock, actorRole } = vi.hoisted(() => ({
  createColabMock: vi.fn(),
  updateColabMock: vi.fn(),
  findExactRetryMock: vi.fn(),
  normalizeAvatarUploadMock: vi.fn(),
  discardAvatarUploadMock: vi.fn(),
  inviteEmployeeAccessMock: vi.fn(),
  getColaboradorMock: vi.fn(),
  actorRole: { value: 'ADMIN' },
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockImplementation(async () => ({
    user: { id: 'user-1', contaId: 'conta-1', role: actorRole.value, name: 'Admin' },
  })),
}));

vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));

vi.mock('@/src/server/platform-billing/capacity', () => ({
  assertPlatformAccessForConta: vi.fn(),
}));
vi.mock('../../../../packages/lib/src/server/services/colaborador-service', () => ({
  create: createColabMock,
  update: updateColabMock,
  findExactColaboradorCreateRetry: findExactRetryMock,
  ColaboradorIdentityConflictError: class ColaboradorIdentityConflictError extends Error {},
  MissingProfessorDataError: class MissingProfessorDataError extends Error {},
  ProfessorIdentityConflictError: class ProfessorIdentityConflictError extends Error {},
}));
vi.mock('@/src/server/media/avatar-storage.service', () => ({
  normalizeAvatarUpload: normalizeAvatarUploadMock,
  discardAvatarUpload: discardAvatarUploadMock,
}));
vi.mock('@/src/server/employees/employee-access-invite.service', () => ({
  inviteEmployeeAccess: inviteEmployeeAccessMock,
}));
vi.mock('@/src/server/employees/employee-read.service', () => ({
  listColaboradores: vi.fn(),
  getColaborador: getColaboradorMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  actorRole.value = 'ADMIN';
});

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

  it('preserves a saved employee when invite delivery fails', async () => {
    createColabMock.mockResolvedValueOnce({ id: 'employee-access-1', nome: 'Ana Souza', foto: null });
    inviteEmployeeAccessMock.mockResolvedValueOnce({
      status: 'failed',
      message: 'Colaborador salvo, mas o e-mail não foi enviado.',
      inviteUrl: 'https://app.example.com/auth/register?token=manual',
    });
    const req = new NextRequest('http://localhost/api/colaboradores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Ana Souza', cpf: '529.982.247-25', enderecoCep: '12345-678', cargo: 'RECEPCAO',
        status: 'ATIVO', dataNasc: '1990-01-01', email: 'ana@example.com', telefone1: '11987654321',
        temAcesso: true, roleUsuario: 'RECEPCAO',
      }),
    });

    const response = await handler(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe('employee-access-1');
    expect(body.accessInvite).toMatchObject({ status: 'failed', inviteUrl: expect.stringContaining('token=manual') });
    expect(inviteEmployeeAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1', recordId: 'employee-access-1', email: 'ana@example.com', role: 'RECEPCAO',
    }));
  });

  it('recovers an exact POST retry in the same Conta without creating another employee', async () => {
    createColabMock.mockRejectedValueOnce(new Error('CPF já cadastrado para outro colaborador nesta conta'));
    findExactRetryMock.mockResolvedValueOnce({ id: 'employee-replayed', nome: 'Ana Souza', email: 'ana@example.com' });
    inviteEmployeeAccessMock.mockResolvedValueOnce({ status: 'pending', message: 'Convite existente.', inviteUrl: 'https://app.example.com/auth/register?token=recovered' });
    const req = new NextRequest('http://localhost/api/colaboradores', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Ana Souza', cpf: '529.982.247-25', enderecoCep: '12345-678', cargo: 'RECEPCAO',
        status: 'ATIVO', dataNasc: '1990-01-01', email: 'ana@example.com', telefone1: '11987654321',
        temAcesso: true, roleUsuario: 'RECEPCAO',
      }),
    });

    const response = await handler(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe('employee-replayed');
    expect(body.accessInvite).toMatchObject({ status: 'pending', inviteUrl: expect.stringContaining('token=recovered') });
    expect(createColabMock).toHaveBeenCalledTimes(1);
    expect(findExactRetryMock).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-1', email: 'ana@example.com' }));
  });

  it.each(['RECEPCAO', 'PROFESSOR'])('saves POST employee but denies invite to actor role %s', async (role) => {
    actorRole.value = role;
    createColabMock.mockResolvedValueOnce({ id: 'employee-denied-1', nome: 'Ana Souza' });
    const req = new NextRequest('http://localhost/api/colaboradores', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nome: 'Ana Souza', cpf: '529.982.247-25', enderecoCep: '12345-678', cargo: 'RECEPCAO',
        status: 'ATIVO', dataNasc: '1990-01-01', email: 'ana@example.com', telefone1: '11987654321',
        temAcesso: true, roleUsuario: 'FINANCEIRO',
      }),
    });

    const response = await handler(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe('employee-denied-1');
    expect(body.accessInvite).toMatchObject({ status: 'failed' });
    expect(inviteEmployeeAccessMock).not.toHaveBeenCalled();
  });

  it.each(['RECEPCAO', 'PROFESSOR'])('saves PATCH employee but denies invite to actor role %s', async (role) => {
    actorRole.value = role;
    getColaboradorMock.mockResolvedValueOnce({ id: 'employee-patch-1', email: 'ana@example.com', foto: null });
    updateColabMock.mockResolvedValueOnce({ id: 'employee-patch-1', email: 'ana@example.com' });
    const req = new NextRequest('http://localhost/api/colaboradores/employee-patch-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ temAcesso: true, roleUsuario: 'FINANCEIRO' }),
    });

    const response = await patchHandler(req, { params: Promise.resolve({ id: 'employee-patch-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe('employee-patch-1');
    expect(body.accessInvite).toMatchObject({ status: 'failed' });
    expect(inviteEmployeeAccessMock).not.toHaveBeenCalled();
  });

  it('allows an ADMIN actor to request a staff invite on PATCH', async () => {
    getColaboradorMock.mockResolvedValueOnce({ id: 'employee-patch-admin', email: 'ana@example.com', foto: null });
    updateColabMock.mockResolvedValueOnce({ id: 'employee-patch-admin', email: 'ana@example.com' });
    inviteEmployeeAccessMock.mockResolvedValueOnce({ status: 'sent', message: 'Convite enviado.' });
    const req = new NextRequest('http://localhost/api/colaboradores/employee-patch-admin', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ temAcesso: true, roleUsuario: 'FINANCEIRO' }),
    });

    const response = await patchHandler(req, { params: Promise.resolve({ id: 'employee-patch-admin' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accessInvite.status).toBe('sent');
    expect(inviteEmployeeAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      invitedById: 'user-1', recordId: 'employee-patch-admin', role: 'FINANCEIRO',
    }));
  });
});
