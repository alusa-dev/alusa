import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runTenant: vi.fn(),
  modalidadeFind: vi.fn(),
  cycleFind: vi.fn(),
  coverageFind: vi.fn(),
  linkFind: vi.fn(),
  transferFind: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: mocks.auth }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: mocks.runTenant }));

import { GET as getCycles } from '@/app/api/modalidades/[id]/ciclos/route';
import { GET as getCoverage } from '@/app/api/modalidades/[id]/cobertura-historica/route';
import { PATCH as patchClassification } from '@/app/api/matriculas/vinculos-academicos/[id]/classificacao/route';
import { GET as getStudentLinks } from '@/app/api/alunos/[id]/vinculos-academicos/route';
import { GET as getEnrollmentLinks } from '@/app/api/matriculas/[id]/vinculos-academicos/route';
import { PATCH as reconcileHistory } from '@/app/api/matriculas/vinculos-academicos/[id]/reconciliacao-historica/route';

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('academic classification routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ ok: true, contaId: 'tenant-a', userId: 'admin-1', role: 'ADMIN', authContext: 'OWNER' });
    mocks.runTenant.mockImplementation((_contaId, callback) => callback({
      $executeRaw: vi.fn().mockResolvedValue(1),
      modalidade: { findFirst: mocks.modalidadeFind },
      cicloAcademico: { findMany: mocks.cycleFind, findFirst: mocks.cycleFind, create: vi.fn() },
      historicoAcademicoCobertura: { findFirst: mocks.coverageFind },
      matriculaVinculoAcademico: { findFirst: mocks.linkFind },
      transferenciaAcademicaVinculo: { findFirst: mocks.transferFind },
    }));
  });

  it('hides cycles when the modality does not belong to the tenant', async () => {
    mocks.modalidadeFind.mockResolvedValue(null);
    const response = await getCycles(new Request('https://alusa.test/api/modalidades/m-foreign/ciclos?contaId=tenant-a'), { params: Promise.resolve({ id: 'm-foreign' }) });
    expect(response.status).toBe(404);
    expect(mocks.cycleFind).not.toHaveBeenCalled();
  });

  it('hides historical coverage when the modality is outside the tenant', async () => {
    mocks.modalidadeFind.mockResolvedValue(null);
    const response = await getCoverage(new Request('https://alusa.test/api/modalidades/m-foreign/cobertura-historica?contaId=tenant-a'), { params: Promise.resolve({ id: 'm-foreign' }) });
    expect(response.status).toBe(404);
    expect(mocks.coverageFind).not.toHaveBeenCalled();
  });

  it('does not permit manual TRANSFERENCIA without a formal relationship', async () => {
    mocks.linkFind.mockResolvedValue({ id: 'link-1', contaId: 'tenant-a', classificacao: 'HISTORICO_INDETERMINADO' });
    mocks.transferFind.mockResolvedValue(null);
    const response = await patchClassification(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/classificacao', {
      classificacao: 'TRANSFERENCIA', motivo: 'Documento de transferência validado.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });
    expect(response.status).toBe(409);
  });

  it('records manual HISTORICO_INDETERMINADO → RETORNO with reason and actor', async () => {
      const classificacao = 'RETORNO' as const;
      const motivo = 'Histórico revisado pelo administrador.';
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
      const findFirst = vi.fn()
        .mockResolvedValueOnce({ id: 'link-1', contaId: 'tenant-a', classificacao: 'HISTORICO_INDETERMINADO' })
        .mockResolvedValueOnce({ id: 'link-1', contaId: 'tenant-a', classificacao });
      mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
        matriculaVinculoAcademico: { findFirst, updateMany },
        transferenciaAcademicaVinculo: { findFirst: vi.fn().mockResolvedValue(null) },
        matriculaClassificacaoAudit: { create: auditCreate },
      }));

      const response = await patchClassification(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/classificacao', {
        classificacao, motivo,
      }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });

      expect(response.status).toBe(200);
      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'link-1', contaId: 'tenant-a', classificacao: 'HISTORICO_INDETERMINADO' },
        data: expect.objectContaining({ classificacao, classificacaoOrigem: 'MANUAL_ADMIN', classificacaoMotivo: motivo }),
      }));
      expect(auditCreate).toHaveBeenCalledWith({ data: {
        contaId: 'tenant-a', vinculoAcademicoId: 'link-1',
        de: 'HISTORICO_INDETERMINADO', para: classificacao, motivo, autorId: 'admin-1',
      } });
  });

  it('treats an identical formal-transfer PATCH retry as a no-op preserving provenance', async () => {
    const current = {
      id: 'link-1', contaId: 'tenant-a', classificacao: 'TRANSFERENCIA',
      classificacaoOrigem: 'TRANSFERENCIA_FORMAL', classificacaoMotivo: 'TRANSFER_FORMALIZADA',
    };
    const findFirst = vi.fn().mockResolvedValue(current);
    const updateMany = vi.fn();
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst, updateMany },
      transferenciaAcademicaVinculo: { findFirst: vi.fn().mockResolvedValue({ id: 'transfer-1', status: 'FORMALIZADA' }) },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));

    const response = await patchClassification(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/classificacao', {
      classificacao: 'TRANSFERENCIA', motivo: 'TRANSFER_FORMALIZADA',
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ classificacao: 'TRANSFERENCIA', classificacaoOrigem: 'TRANSFERENCIA_FORMAL' });
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects a different manual payload for a formally transferred link without writes', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'link-1', contaId: 'tenant-a', classificacao: 'TRANSFERENCIA',
      classificacaoOrigem: 'TRANSFERENCIA_FORMAL', classificacaoMotivo: 'TRANSFER_FORMALIZADA',
    });
    const updateMany = vi.fn();
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst, updateMany },
      transferenciaAcademicaVinculo: { findFirst: vi.fn().mockResolvedValue({ id: 'transfer-1', status: 'FORMALIZADA' }) },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));

    const response = await patchClassification(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/classificacao', {
      classificacao: 'TRANSFERENCIA', motivo: 'Outra justificativa administrativa.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'TRANSFERENCIA_EXIGE_RELACAO_FORMAL' } });
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('treats an identical manual classification retry as a no-op without another audit', async () => {
    const current = {
      id: 'link-1', contaId: 'tenant-a', classificacao: 'RETORNO',
      classificacaoOrigem: 'MANUAL_ADMIN', classificacaoMotivo: 'Histórico revisado pelo administrador.',
    };
    const updateMany = vi.fn();
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst: vi.fn().mockResolvedValue(current), updateMany },
      transferenciaAcademicaVinculo: { findFirst: vi.fn().mockResolvedValue(null) },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));

    const response = await patchClassification(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/classificacao', {
      classificacao: 'RETORNO', motivo: current.classificacaoMotivo,
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject(current);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('returns a stable conflict and skips audit when classification CAS is lost', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: {
        findFirst: vi.fn().mockResolvedValue({ id: 'link-1', contaId: 'tenant-a', classificacao: 'HISTORICO_INDETERMINADO' }),
        updateMany,
      },
      transferenciaAcademicaVinculo: { findFirst: vi.fn().mockResolvedValue(null) },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));

    const response = await patchClassification(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/classificacao', {
      classificacao: 'RETORNO', motivo: 'Histórico validado pelo administrador.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'CLASSIFICACAO_CONCORRENTE' } });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'link-1', contaId: 'tenant-a', classificacao: 'HISTORICO_INDETERMINADO' },
    }));
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('does not expose or mutate another tenant classification', async () => {
    const updateMany = vi.fn();
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst: vi.fn().mockResolvedValue(null), updateMany },
      transferenciaAcademicaVinculo: { findFirst: vi.fn() },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));
    const response = await patchClassification(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/foreign-link/classificacao', {
      classificacao: 'RETORNO', motivo: 'Validação administrativa do histórico.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'foreign-link' }) });
    expect(response.status).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('keeps a link indeterminate while its concrete transfer operation is pending', async () => {
    const updateMany = vi.fn();
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst: vi.fn().mockResolvedValue({ id: 'link-1', contaId: 'tenant-a', classificacao: 'HISTORICO_INDETERMINADO' }), updateMany },
      transferenciaAcademicaVinculo: { findFirst: vi.fn().mockResolvedValue({ id: 'transfer-1', status: 'PENDENTE' }) },
      matriculaClassificacaoAudit: { create: auditCreate },
    }));
    const response = await patchClassification(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/classificacao', {
      classificacao: 'RETORNO', motivo: 'Histórico precisa permanecer indeterminado.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });
    expect(response.status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['student links', getStudentLinks, 'https://alusa.test/api/alunos/student-1/vinculos-academicos', { id: 'student-1' }],
    ['enrollment links', getEnrollmentLinks, 'https://alusa.test/api/matriculas/enrollment-1/vinculos-academicos', { id: 'enrollment-1' }],
  ] as const)('blocks PORTAL from reading %s', async (_name, handler, url, params) => {
    mocks.auth.mockResolvedValue({ ok: true, contaId: 'tenant-a', userId: 'portal-1', role: 'RESPONSAVEL', authContext: 'PORTAL' });
    const response = await handler(new Request(url), { params: Promise.resolve(params) } as never);
    expect(response.status).toBe(403);
    expect(mocks.runTenant).not.toHaveBeenCalled();
  });

  it('reconciles legacy cycle and effective date with an audit reason', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const linkFind = vi.fn().mockResolvedValueOnce({ id: 'link-1', modalidadeId: 'modality-a', cicloAcademicoId: null, vigenciaIniciadaEm: null }).mockResolvedValueOnce({ id: 'link-1', cicloAcademicoId: 'cycle-a' });
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst: linkFind, updateMany },
      cicloAcademico: { findFirst: vi.fn().mockResolvedValue({ id: 'cycle-a' }) },
      matriculaVinculoAcademicoAudit: { create: auditCreate },
    }));
    const response = await reconcileHistory(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/reconciliacao-historica', {
      cicloAcademicoId: 'cycle-a', vigenciaIniciadaEm: '2024-02-01T00:00:00.000Z', motivo: 'Histórico conferido em documentos institucionais.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });
    expect(response.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'link-1', contaId: 'tenant-a', cicloAcademicoId: null, vigenciaIniciadaEm: null } }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ autorId: 'admin-1', motivo: expect.any(String) }) }));
  });

  it('does not expose or reconcile another tenant historical link', async () => {
    const updateMany = vi.fn();
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst: vi.fn().mockResolvedValue(null), updateMany },
      cicloAcademico: { findFirst: vi.fn() },
      matriculaVinculoAcademicoAudit: { create: auditCreate },
    }));
    const response = await reconcileHistory(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/foreign-link/reconciliacao-historica', {
      cicloAcademicoId: 'cycle-a', vigenciaIniciadaEm: '2024-02-01T00:00:00.000Z', motivo: 'Histórico conferido em documentos.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'foreign-link' }) });
    expect(response.status).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects a concurrent history reconciliation when the observed snapshot changed', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: { findFirst: vi.fn().mockResolvedValue({ id: 'link-1', modalidadeId: 'modality-a', cicloAcademicoId: null, vigenciaIniciadaEm: null }), updateMany },
      cicloAcademico: { findFirst: vi.fn().mockResolvedValue({ id: 'cycle-a' }) },
      matriculaVinculoAcademicoAudit: { create: auditCreate },
    }));
    const response = await reconcileHistory(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/reconciliacao-historica', {
      cicloAcademicoId: 'cycle-a', vigenciaIniciadaEm: '2024-02-01T00:00:00.000Z', motivo: 'Histórico conferido em documentos institucionais.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });
    expect(response.status).toBe(409);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects replay after reconciliation without duplicating the audit', async () => {
    const updateMany = vi.fn();
    const auditCreate = vi.fn();
    mocks.runTenant.mockImplementationOnce((_contaId, callback) => callback({
      matriculaVinculoAcademico: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'link-1', modalidadeId: 'modality-a', cicloAcademicoId: 'cycle-a',
          vigenciaIniciadaEm: new Date('2024-02-01T00:00:00.000Z'),
        }),
        updateMany,
      },
      cicloAcademico: { findFirst: vi.fn() },
      matriculaVinculoAcademicoAudit: { create: auditCreate },
    }));
    const response = await reconcileHistory(jsonRequest('https://alusa.test/api/matriculas/vinculos-academicos/link-1/reconciliacao-historica', {
      cicloAcademicoId: 'cycle-a', vigenciaIniciadaEm: '2024-02-01T00:00:00.000Z', motivo: 'Histórico conferido em documentos institucionais.',
    }, 'PATCH'), { params: Promise.resolve({ id: 'link-1' }) });
    expect(response.status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

});
