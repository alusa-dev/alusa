import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEventsContext: vi.fn(),
  getEventReportDetail: vi.fn(),
  handleEventsRouteError: vi.fn((error: unknown) => Response.json({ error: String(error) }, { status: 403 })),
}));

vi.mock('../../../app/api/events/_helpers', () => ({
  getEventsContext: mocks.getEventsContext,
  handleEventsRouteError: mocks.handleEventsRouteError,
}));
vi.mock('@alusa/lib/events/event-report-detail.service', () => ({ getEventReportDetail: mocks.getEventReportDetail }));
vi.mock('@alusa/lib/events/events.service', () => ({ EventsError: class EventsError extends Error {} }));

import { GET } from '../../../app/api/events/reports/[eventId]/route';

describe('GET /api/events/reports/[eventId]', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('requires eventReports.view and passes only the session tenant to the reader', async () => {
    mocks.getEventsContext.mockResolvedValue({ contaId: 'tenant-a', userId: 'user-a' });
    mocks.getEventReportDetail.mockResolvedValue({ event: { id: 'event-a' }, totals: {} });
    const response = await GET(new Request('https://alusa.test/api/events/reports/event-a'), { params: Promise.resolve({ eventId: 'event-a' }) });

    expect(mocks.getEventsContext).toHaveBeenCalledWith('eventReports.view');
    expect(mocks.getEventReportDetail).toHaveBeenCalledWith('tenant-a', 'event-a');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('private');
  });

  it('does not query the service when report permission is denied', async () => {
    mocks.getEventsContext.mockRejectedValue(new Error('denied'));
    const response = await GET(new Request('https://alusa.test/api/events/reports/event-a'), { params: Promise.resolve({ eventId: 'event-a' }) });
    expect(response.status).toBe(403);
    expect(mocks.getEventReportDetail).not.toHaveBeenCalled();
  });
});
