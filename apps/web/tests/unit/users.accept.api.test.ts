import { describe, it, expect } from 'vitest';
import { GET, POST } from '@/app/api/users/accept/route';

async function asJson(res: Response) { try { return await res.json(); } catch { return null; } }

describe('/api/users/accept (validações básicas)', () => {
  it('GET sem token -> 400', async () => {
    const req = new Request('http://x/api/users/accept');
    const res = await GET(req as unknown as Request);
    expect(res.status).toBe(400);
    const body = await asJson(res);
    expect(body?.error).toBeTruthy();
  });

  it('POST com senha fraca -> 400', async () => {
    const req = new Request('http://x/api/users/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 't', name: 'X', password: '123' })
    });
    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
  });

  it('POST com email inválido -> 400', async () => {
    const req = new Request('http://x/api/users/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 't', name: 'Nome Válido', password: 'Abcdef1!', email: 'invalido' })
    });
    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(400);
  });
});

