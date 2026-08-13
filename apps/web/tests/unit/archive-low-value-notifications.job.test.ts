/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/lib', () => ({
  archiveLowValueNotifications: vi.fn(),
}));

const { getServerSession } = await import('next-auth');
const { archiveLowValueNotifications } = await import('@alusa/lib');
const { POST } = await import('@/app/api/jobs/archive-low-value-notifications/route');

describe('archive-low-value-notifications job', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.mocked(archiveLowValueNotifications).mockResolvedValue({
      archived: 2,
      cutoff: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exige autenticação ou segredo de cron', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);

    const response = await POST(new Request('http://localhost/api/jobs/archive-low-value-notifications', {
      method: 'POST',
    }));

    expect(response.status).toBe(401);
    expect(archiveLowValueNotifications).not.toHaveBeenCalled();
  });

  it('impede admin de informar outro tenant', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'user-1', role: 'ADMIN', contaId: 'conta-1' },
    } as never);

    const response = await POST(new Request(
      'http://localhost/api/jobs/archive-low-value-notifications?contaId=conta-2',
      { method: 'POST' },
    ));

    expect(response.status).toBe(403);
    expect(archiveLowValueNotifications).not.toHaveBeenCalled();
  });

  it('permite execução cron e repassa limites controlados', async () => {
    process.env.CRON_SECRET_TOKEN = 'cron-secret';
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);

    const response = await POST(new Request(
      'http://localhost/api/jobs/archive-low-value-notifications?contaId=conta-1&olderThanDays=45&limit=100',
      {
        method: 'POST',
        headers: { 'x-cron-token': 'cron-secret' },
      },
    ));

    expect(response.status).toBe(200);
    expect(archiveLowValueNotifications).toHaveBeenCalledWith({
      contaId: 'conta-1',
      olderThanDays: 45,
      limit: 100,
    });
  });
});
