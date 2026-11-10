import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), runTenant: vi.fn() }));
vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: mocks.auth }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: mocks.runTenant }));

import { POST as registerTransfer } from '@/app/api/matriculas/vinculos-academicos/[id]/transferencia/route';
import { PATCH as formalizeTransfer } from '@/app/api/matriculas/vinculos-academicos/[id]/transferencia/formalizar/route';

function request(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('academic transfer routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ ok: true, contaId: 'tenant-a', userId: 'admin-a', role: 'ADMIN', authContext: 'OWNER' });
  });

  it('requires an institution administrator to register a pending transfer', async () => {
    mocks.auth.mockResolvedValueOnce({ ok: true, contaId: 'tenant-a', userId: 'portal-a', role: 'RESPONSAVEL', authContext: 'PORTAL' });
    const response = await registerTransfer(request('https://alusa.test/transferencia', 'POST', {
      origemVinculoId: 'source-a', motivo: 'Documentos recebidos.',
    }), { params: Promise.resolve({ id: 'destination-a' }) });
    expect(response.status).toBe(403);
    expect(mocks.runTenant).not.toHaveBeenCalled();
  });

  it('routes a tenant-scoped pending transfer through the service transaction', async () => {
    const source = { id: 'source-a', modalidadeId: 'course-a', vigenciaIniciadaEm: new Date(), matricula: { alunoId: 'student-a' } };
    const destination = { id: 'destination-a', modalidadeId: 'course-b', classificacao: 'PRIMEIRO_INGRESSO', matricula: { alunoId: 'student-a' } };
    const linkFind = vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(destination);
    const transferFind = vi.fn().mockResolvedValue(null);
    const transferCreate = vi.fn().mockResolvedValue({ id: 'transfer-a', status: 'PENDENTE' });
    const linkUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst: linkFind, updateMany: linkUpdate },
      transferenciaAcademicaVinculo: { findFirst: transferFind, create: transferCreate },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));

    const response = await registerTransfer(request('https://alusa.test/transferencia', 'POST', {
      origemVinculoId: 'source-a', motivo: 'Documentos recebidos.',
    }), { params: Promise.resolve({ id: 'destination-a' }) });
    expect(response.status).toBe(201);
    expect(mocks.runTenant).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(transferCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      contaId: 'tenant-a', status: 'PENDENTE', solicitadaPor: 'admin-a',
    }) }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      de: 'PRIMEIRO_INGRESSO', para: 'HISTORICO_INDETERMINADO', autorId: 'admin-a',
    }) }));
  });

  it('formalizes the pending transfer in the authenticated tenant context', async () => {
    const relation = { id: 'transfer-a', origemVinculoId: 'source-a', destinoVinculoId: 'destination-a', motivo: 'Documentos recebidos.', status: 'PENDENTE' };
    const transferFind = vi.fn().mockResolvedValueOnce(relation).mockResolvedValueOnce(null);
    const linkFind = vi.fn()
      .mockResolvedValueOnce({ id: 'source-a', modalidadeId: 'course-a', vigenciaIniciadaEm: new Date(), matricula: { alunoId: 'student-a' } })
      .mockResolvedValueOnce({ id: 'destination-a', modalidadeId: 'course-b', cicloAcademicoId: 'cycle-b', classificacao: 'HISTORICO_INDETERMINADO', matricula: { alunoId: 'student-a' } });
    const relationUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const linkUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      transferenciaAcademicaVinculo: { findFirst: transferFind, updateMany: relationUpdate },
      matriculaVinculoAcademico: { findFirst: linkFind, updateMany: linkUpdate },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));

    const response = await formalizeTransfer(request('https://alusa.test/formalizar', 'PATCH'), {
      params: Promise.resolve({ id: 'destination-a' }),
    });
    expect(response.status).toBe(200);
    expect(relationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'transfer-a', contaId: 'tenant-a', status: 'PENDENTE' },
    }));
    expect(linkUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'destination-a', contaId: 'tenant-a', classificacao: 'HISTORICO_INDETERMINADO' },
      data: expect.objectContaining({ classificacao: 'TRANSFERENCIA' }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      de: 'HISTORICO_INDETERMINADO', para: 'TRANSFERENCIA', autorId: 'admin-a',
    }) }));
  });

  it('hides a cross-tenant destination and writes nothing', async () => {
    const create = vi.fn();
    const linkUpdate = vi.fn();
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst: vi.fn().mockResolvedValue(null), updateMany: linkUpdate },
      transferenciaAcademicaVinculo: { findFirst: vi.fn(), create },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));
    const response = await registerTransfer(request('https://alusa.test/transferencia', 'POST', {
      origemVinculoId: 'source-foreign', motivo: 'Documentos recebidos.',
    }), { params: Promise.resolve({ id: 'destination-foreign' }) });
    expect(response.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
    expect(linkUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
