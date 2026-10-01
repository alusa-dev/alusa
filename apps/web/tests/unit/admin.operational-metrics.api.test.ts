/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { createSupportAuditMock } = vi.hoisted(() => ({ createSupportAuditMock: vi.fn() }));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@alusa/database', () => ({
  prisma: { supportAuditLog: { create: createSupportAuditMock } },
}));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: () => 'request-12345678' }));
vi.mock('@alusa/finance', () => ({
  collectOperationalMetrics: vi.fn(() => ({ scope: 'instance-local', generatedAt: 'now', accounts: { hidden: 1 } })),
}));

import { getServerSession } from 'next-auth';
import { collectOperationalMetrics } from '@alusa/finance';
import { GET } from '@/app/api/admin/webhooks/metrics/operational/route';

describe('GET /api/admin/webhooks/metrics/operational', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exige autenticação', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    const response = await GET(new NextRequest('http://localhost/api/admin/webhooks/metrics/operational'));
    expect(response.status).toBe(401);
    expect(collectOperationalMetrics).not.toHaveBeenCalled();
  });

  it('nega admins de tenant porque o snapshot contém estado agregado entre contas', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'admin-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);
    const response = await GET(new NextRequest('http://localhost/api/admin/webhooks/metrics/operational'));
    expect(response.status).toBe(403);
    expect(collectOperationalMetrics).not.toHaveBeenCalled();
  });

  it('retorna snapshot sem cache marcado como local à instância para superadmin', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'support-1', role: 'SUPER_ADMIN' },
    } as never);
    const response = await GET(new NextRequest('http://localhost/api/admin/webhooks/metrics/operational?windowMinutes=120'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-observability-scope')).toBe('instance-local');
    expect(await response.json()).toMatchObject({ success: true, scope: 'instance-local' });
    expect(collectOperationalMetrics).toHaveBeenCalledWith(60);
    expect(createSupportAuditMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'support-1',
        action: 'admin.observability.operational_metrics.viewed',
        entityType: 'GLOBAL_OPERATIONAL_METRICS',
        correlationId: 'request-12345678',
        metadata: { actorRole: 'SUPER_ADMIN', scope: 'instance-local', windowMinutes: 60 },
      }),
    });
    expect(JSON.stringify(createSupportAuditMock.mock.calls)).not.toContain('accounts');
  });

  it('não retorna o snapshot se não conseguir registrar a auditoria', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'support-1', email: 'support@example.test', role: 'SUPER_ADMIN' },
    } as never);
    createSupportAuditMock.mockRejectedValueOnce(new Error('audit unavailable'));
    const response = await GET(new NextRequest('http://localhost/api/admin/webhooks/metrics/operational'));
    expect(response.status).toBe(500);
    expect(collectOperationalMetrics).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it('não oferece formato Prometheus em rota autenticada por sessão', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'support-1', role: 'SUPER_ADMIN' },
    } as never);
    const response = await GET(new NextRequest('http://localhost/api/admin/webhooks/metrics/operational?format=prometheus'));
    expect(response.status).toBe(406);
    expect(collectOperationalMetrics).not.toHaveBeenCalled();
  });
});
