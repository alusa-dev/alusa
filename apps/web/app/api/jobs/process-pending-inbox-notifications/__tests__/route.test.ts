/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processPendingInboxNotifications, getServerSession } = vi.hoisted(() => ({
  processPendingInboxNotifications: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@alusa/lib', () => ({ processPendingInboxNotifications }));

import { GET, POST } from '../route';

describe('GET|POST /api/jobs/process-pending-inbox-notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET_TOKEN = 'cron-secret';
    getServerSession.mockResolvedValue(null);
    processPendingInboxNotifications.mockResolvedValue({ attempted: 1, processed: 1, failed: 0 });
  });

  it('aceita GET autenticado pelo cron', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/process-pending-inbox-notifications?limit=3', {
      headers: { 'x-cron-token': 'cron-secret' },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, attempted: 1 });
    expect(processPendingInboxNotifications).toHaveBeenCalledWith({ contaId: undefined, limit: 3 });
  });

  it('preserva POST como compatibilidade', async () => {
    const response = await POST(new Request('http://localhost/api/jobs/process-pending-inbox-notifications', {
      method: 'POST',
      headers: { 'x-cron-token': 'cron-secret' },
    }));

    expect(response.status).toBe(200);
    expect(processPendingInboxNotifications).toHaveBeenCalledTimes(1);
  });

  it('bloqueia chamada sem autenticação', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/process-pending-inbox-notifications'));

    expect(response.status).toBe(401);
    expect(processPendingInboxNotifications).not.toHaveBeenCalled();
  });
});
