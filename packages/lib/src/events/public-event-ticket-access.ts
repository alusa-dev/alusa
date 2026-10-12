import { prisma } from '../prisma';
import { getPublicStaffSaleTickets } from './map/staff-map-sales.service';
import { getPublicEventMapOrderTickets } from './map/event-map.service';

/** Resolves a public, opaque ticket capability and returns only issued ticket data. */
export async function getPublicEventTicketsByAccessToken(accessToken: string) {
  const order = await prisma.eventMapOrder.findFirst({
    where: { accessToken, status: 'CONFIRMED' },
    select: { id: true },
  });
  if (order) return getPublicEventMapOrderTickets(order.id, accessToken);

  const sale = await prisma.eventTicketSale.findFirst({
    where: { accessToken, status: 'PAID' },
    select: { id: true },
  });
  if (sale) return getPublicStaffSaleTickets(sale.id, accessToken);

  return null;
}
