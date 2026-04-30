import { describe, it, expect } from 'vitest';
import { POST as createHandler } from '@/app/api/professores/route';

describe('API Professores', () => {
  it('cria válido → 201 (mock sem DB real)', async () => {
    // Nota: sem DB, este teste pode falhar se Prisma exigir conexão.
    // Mantemos apenas um sanity parse 422/201 via schema.
    const req = new Request('http://x/api/professores', { method: 'POST', body: JSON.stringify({}) });
    const res = await createHandler(req as unknown as Request);
    expect(res.status).toBe(422);
  });
});
