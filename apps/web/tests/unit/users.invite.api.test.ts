import { describe, it, expect } from 'vitest';
import { POST } from '@/app/api/users/invite/route';

describe('/api/users/invite (restrições)', () => {
  it('bloqueia convites para ADMIN', async () => {
    const req = new Request('http://x/api/users/invite', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@example.com', role: 'ADMIN' })
    });
    const res = await POST(req as unknown as Request);
    expect(res.status).toBe(403);
  });
});
