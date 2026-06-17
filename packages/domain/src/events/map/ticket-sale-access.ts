export const STAFF_SALE_PRINTABLE_STATUSES = ['PAID', 'COMPLIMENTARY'] as const;

export type StaffSalePrintableStatus = (typeof STAFF_SALE_PRINTABLE_STATUSES)[number];

export function canPrintStaffSaleTickets(status: string): status is StaffSalePrintableStatus {
  return (STAFF_SALE_PRINTABLE_STATUSES as readonly string[]).includes(status);
}

export function buildStaffSaleTicketsUrl(
  saleId: string,
  status: string,
  seatedCount: number,
): string | null {
  if (seatedCount === 0 || !canPrintStaffSaleTickets(status)) return null;
  return `/api/events/ticket-sales/${saleId}/tickets`;
}
