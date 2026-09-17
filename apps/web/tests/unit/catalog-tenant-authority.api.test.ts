import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getServerSession: vi.fn() }));

vi.mock('next-auth', () => ({ getServerSession: mocks.getServerSession }));

import { POST as createModalidade } from '@/app/api/modalidades/route';
import { GET as listSalas } from '@/app/api/salas/route';
import { GET as listBillingGroups } from '@/app/api/matriculas/billing-groups/route';
import { GET as listProfessores } from '@/app/api/professores/route';
import { PATCH as updateTurma } from '@/app/api/turmas/[id]/route';
import { DELETE as deleteCombo } from '@/app/api/combos/[id]/route';

const contaA = 'conta-a';
const contaB = 'conta-b';

describe('catalog tenant authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: 'user-a', contaId: contaA } });
  });

  it('never accepts a query contaId without an authenticated tenant', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const response = await listSalas(new Request(`http://localhost/api/salas?contaId=${contaB}`));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('NAO_AUTENTICADO');
  });

  it('rejects a cross-tenant query before listing catalog data', async () => {
    const response = await listSalas(new Request(`http://localhost/api/salas?contaId=${contaB}`));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CONTA_INVALIDA');
  });

  it('rejects a cross-tenant contaId in a mutation body', async () => {
    const response = await createModalidade(
      new Request('http://localhost/api/modalidades', {
        method: 'POST',
        body: JSON.stringify({ contaId: contaB, nome: 'Modalidade indevida' }),
      }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CONTA_INVALIDA');
  });

  it('rejects cross-tenant resource mutations before validation or persistence', async () => {
    const response = await updateTurma(
      new Request('http://localhost/api/turmas/turma-b', {
        method: 'PATCH',
        body: JSON.stringify({ contaId: contaB }),
      }),
      { params: Promise.resolve({ id: 'turma-b' }) },
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CONTA_INVALIDA');
  });

  it('rejects a cross-tenant contaId on deletion commands', async () => {
    const response = await deleteCombo(
      new Request('http://localhost/api/combos/combo-b', {
        method: 'DELETE',
        body: JSON.stringify({ contaId: contaB }),
      }),
      { params: Promise.resolve({ id: 'combo-b' }) },
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CONTA_INVALIDA');
  });

  it('does not allow billing-group lookup to select another tenant', async () => {
    const response = await listBillingGroups(
      new Request(`http://localhost/api/matriculas/billing-groups?contaId=${contaB}`),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CONTA_INVALIDA');
  });

  it('does not allow professor lookup to select another tenant', async () => {
    const response = await listProfessores(
      new Request(`http://localhost/api/professores?contaId=${contaB}`),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('CONTA_INVALIDA');
  });

  it('does not use a client tenant when the professor lookup has no session', async () => {
    mocks.getServerSession.mockResolvedValueOnce(null);

    const response = await listProfessores(
      new Request(`http://localhost/api/professores?contaId=${contaB}`),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('NAO_AUTENTICADO');
  });
});
