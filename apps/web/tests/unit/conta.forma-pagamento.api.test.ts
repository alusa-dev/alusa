import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { POST as changeMethodPost } from '@/app/api/conta/forma-pagamento/change-method/route';
import { POST as updateCardPost } from '@/app/api/conta/forma-pagamento/update-card/route';
import { POST as validateCardPost } from '@/app/api/conta/forma-pagamento/validate-card/route';

const buildRequest = (url: string): NextRequest =>
  new Request(url, { method: 'POST' }) as unknown as NextRequest;

describe('Conta Forma de Pagamento APIs (portal)', () => {
  beforeEach(() => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1', role: 'RESPONSAVEL', contaId: 'conta-1' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueia mudança de forma de pagamento', async () => {
    const response = await changeMethodPost(buildRequest('http://localhost/api/conta/forma-pagamento/change-method'));
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/secretaria/i);
  });

  it('bloqueia atualização de cartão', async () => {
    const response = await updateCardPost(buildRequest('http://localhost/api/conta/forma-pagamento/update-card'));
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/cartão/i);
  });

  it('bloqueia validação/tokenização de cartão', async () => {
    const response = await validateCardPost(buildRequest('http://localhost/api/conta/forma-pagamento/validate-card'));
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/financeiro/i);
  });

  it('retorna 401 quando não autenticado', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const response = await changeMethodPost(buildRequest('http://localhost/api/conta/forma-pagamento/change-method'));
    expect(response.status).toBe(401);
  });
});
