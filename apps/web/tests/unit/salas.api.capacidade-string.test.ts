import { describe, it, expect } from 'vitest';
import { POST } from '@/app/api/salas/route';

interface SalaBody {
  nome: string;
  capacidade: string | number;
  contaId?: string;
}
function makeReq(body: SalaBody) {
  return new Request('http://localhost/api/salas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('salas.api capacidade string', () => {
  it('aceita capacidade enviada como string numerica', async () => {
    const req = makeReq({
      nome: `Sala Cap String ${Date.now()}`,
      capacidade: '15',
      contaId: 'conta-default',
    });
    const res = await POST(req as unknown as Request);
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.data.capacidade).toBe(15);
  });
});
