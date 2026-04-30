import { describe, it, expect } from 'vitest';
import { POST as handler } from '@/app/api/colaboradores/route';
import { NextRequest } from 'next/server';

describe('API Colaboradores', () => {
  it('retorna 400 para payload inválido', async () => {
  const req = new NextRequest('http://localhost/api/colaboradores', { method: 'POST', body: JSON.stringify({}) });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });
});
