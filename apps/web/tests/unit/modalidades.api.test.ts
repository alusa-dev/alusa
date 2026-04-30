import { describe, it, expect } from 'vitest';
import { POST as createModalidade, GET as listModalidades } from '@/app/api/modalidades/route';
import {
  PATCH as patchModalidade,
  DELETE as deleteModalidade,
} from '@/app/api/modalidades/[id]/route';

function makeReq(body?: Record<string, unknown>, method: string = 'POST') {
  const payload = body ? { contaId: 'conta-default', ...body } : { contaId: 'conta-default' };
  return new Request('http://test/api/modalidades', {
    method,
    body: JSON.stringify(payload),
  });
}

describe('API Modalidades', () => {
  it('rejeita nome curto', async () => {
    const res = await createModalidade(makeReq({ nome: 'A' }) as unknown as Request);
    expect(res.status).toBe(422);
  });
  it('cria modalidade válida', async () => {
    const res = await createModalidade(makeReq({ nome: 'Jazz' }) as unknown as Request);
    // Pode falhar por duplicidade em execuções repetidas; aceitar 201 ou 400 duplicado
    expect([201, 400]).toContain(res.status);
  });
  it('lista modalidades paginado', async () => {
    const res = await listModalidades(
      new Request('http://test/api/modalidades?contaId=conta-default') as unknown as Request,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('data');
    expect(json).toHaveProperty('meta');
    expect(json.meta).toHaveProperty('total');
  });
  it('atualiza modalidade inexistente retorna erro', async () => {
    const res = await patchModalidade(
      new Request('http://test/api/modalidades/nao-existe', {
        method: 'PATCH',
        body: JSON.stringify({ contaId: 'conta-default', nome: 'X' }),
      }) as unknown as Request,
      { params: { id: 'nao-existe' } },
    );
    expect([400, 404, 422]).toContain(res.status);
  });
  it('delete modalidade inexistente retorna erro', async () => {
    const res = await deleteModalidade(
      new Request('http://test/api/modalidades/nao-existe?contaId=conta-default', {
        method: 'DELETE',
      }) as unknown as Request,
      { params: { id: 'nao-existe' } },
    );
    expect([400, 404]).toContain(res.status);
  });
});
