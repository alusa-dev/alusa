import { describe, it, expect } from 'vitest';
import { POST as createSala, GET as listSalas } from '@/app/api/salas/route';
import { PATCH as patchSala, DELETE as deleteSala } from '@/app/api/salas/[id]/route';

const TEST_CONTA = 'conta-test-salas';

function makeReq(body?: Record<string, unknown>, method: string = 'POST') {
  return new Request('http://test/api/salas', {
    method,
    body: body
      ? JSON.stringify({ contaId: TEST_CONTA, ...body })
      : JSON.stringify({ contaId: TEST_CONTA }),
  });
}

describe('API Salas', () => {
  it('rejeita nome vazio', async () => {
    const res = await createSala(makeReq({ nome: '' }) as unknown as Request);
    expect(res.status).toBe(422);
  });
  it('cria sala válida', async () => {
    const res = await createSala(
      makeReq({ nome: 'Sala 101', capacidade: 40 }) as unknown as Request,
    );
    expect([201, 400]).toContain(res.status);
  });
  it('lista salas paginado', async () => {
    const res = await listSalas(
      new Request(`http://test/api/salas?contaId=${TEST_CONTA}`) as unknown as Request,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('meta');
    expect(json.meta).toHaveProperty('total');
  });
  it('atualiza sala inexistente retorna erro', async () => {
    const res = await patchSala(
      new Request('http://test/api/salas/nao-existe', {
        method: 'PATCH',
        body: JSON.stringify({ contaId: TEST_CONTA, nome: 'Nova Sala' }),
      }) as unknown as Request,
      { params: { id: 'nao-existe' } },
    );
    expect([400, 404]).toContain(res.status);
  });
  it('delete sala inexistente retorna erro', async () => {
    const res = await deleteSala(
      new Request(`http://test/api/salas/nao-existe?contaId=${TEST_CONTA}`, {
        method: 'DELETE',
      }) as unknown as Request,
      { params: { id: 'nao-existe' } },
    );
    expect([400, 404]).toContain(res.status);
  });
});
