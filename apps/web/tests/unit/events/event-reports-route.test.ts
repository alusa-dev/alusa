import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEventsContext: vi.fn(),
  getEventReports: vi.fn(),
  handleEventsRouteError: vi.fn((error: unknown) => Response.json({ error: String(error) }, { status: 403 })),
  parse: vi.fn((value: unknown) => value),
  runWithTenant: vi.fn(async (_contaId: string, callback: (_tx: object) => Promise<unknown>) => callback({ transaction: true })),
}));

vi.mock('../../../app/api/events/_helpers', () => ({
  getEventsContext: mocks.getEventsContext,
  handleEventsRouteError: mocks.handleEventsRouteError,
  queryObject: (request: Request) => Object.fromEntries(new URL(request.url).searchParams.entries()),
}));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: mocks.runWithTenant }));
vi.mock('@alusa/lib/events/events.schema', () => ({ eventReportQuerySchema: { parse: mocks.parse } }));
vi.mock('@alusa/lib/events/events.service', () => ({ getEventReports: mocks.getEventReports }));

import { GET } from '../../../app/api/events/reports/route';

describe('GET /api/events/reports', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('keeps authenticated report responses private and uncacheable', async () => {
    mocks.getEventsContext.mockResolvedValue({ contaId: 'tenant-a', userId: 'user-a' });
    mocks.getEventReports.mockResolvedValue({ general: {}, events: [] });
    const response = await GET(new Request('https://alusa.test/api/events/reports?eventId=event-a'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.getEventsContext).toHaveBeenCalledWith('eventReports.view');
    expect(mocks.runWithTenant).toHaveBeenCalledWith('tenant-a', expect.any(Function), { isolationLevel: 'RepeatableRead' });
    expect(mocks.getEventReports).toHaveBeenCalledWith({ contaId: 'tenant-a', userId: 'user-a' }, { eventId: 'event-a' }, { transaction: true });
  });

  it('applies private no-store to errors as well', async () => {
    mocks.getEventsContext.mockRejectedValue(new Error('denied'));
    const response = await GET(new Request('https://alusa.test/api/events/reports'));

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.getEventReports).not.toHaveBeenCalled();
  });
});
