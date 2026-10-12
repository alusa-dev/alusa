import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findOrder, findSale, getOrderTickets, getSaleTickets } = vi.hoisted(() => ({
  findOrder: vi.fn(),
  findSale: vi.fn(),
  getOrderTickets: vi.fn(),
  getSaleTickets: vi.fn(),
}));

vi.mock('../prisma', () => ({ prisma: { eventMapOrder: { findFirst: findOrder }, eventTicketSale: { findFirst: findSale } } }));
vi.mock('./map/event-map.service', () => ({ getPublicEventMapOrderTickets: getOrderTickets }));
vi.mock('./map/staff-map-sales.service', () => ({ getPublicStaffSaleTickets: getSaleTickets }));

import { getPublicEventTicketsByAccessToken } from './public-event-ticket-access';

describe('getPublicEventTicketsByAccessToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves only confirmed public orders before returning the issued PDF data', async () => {
    findOrder.mockResolvedValue({ id: 'order-1' });
    getOrderTickets.mockResolvedValue([{ id: 'ticket-1' }]);

    await expect(getPublicEventTicketsByAccessToken('opaque-token')).resolves.toEqual([{ id: 'ticket-1' }]);
    expect(findOrder).toHaveBeenCalledWith({ where: { accessToken: 'opaque-token', status: 'CONFIRMED' }, select: { id: true } });
    expect(getOrderTickets).toHaveBeenCalledWith('order-1', 'opaque-token');
    expect(findSale).not.toHaveBeenCalled();
  });

  it('resolves only paid staff sales and returns null for unknown capabilities', async () => {
    findOrder.mockResolvedValue(null);
    findSale.mockResolvedValueOnce({ id: 'sale-1' });
    getSaleTickets.mockResolvedValue([{ id: 'ticket-2' }]);

    await expect(getPublicEventTicketsByAccessToken('opaque-token')).resolves.toEqual([{ id: 'ticket-2' }]);
    expect(findSale).toHaveBeenCalledWith({ where: { accessToken: 'opaque-token', status: 'PAID' }, select: { id: true } });

    findSale.mockResolvedValueOnce(null);
    await expect(getPublicEventTicketsByAccessToken('unknown')).resolves.toBeNull();
  });
});
