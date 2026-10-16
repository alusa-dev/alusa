import type { TicketSaleDTO } from '../events-service';

type TicketReportSale = Pick<TicketSaleDTO, 'status' | 'quantity' | 'totalAmount' | 'refundedAmount'>;

export function getTicketReportMetrics(sales: TicketReportSale[]) {
  const manualSales = sales.filter((sale) => sale.status !== 'RESERVED');

  return {
    revenue: manualSales
      .filter((sale) => sale.status === 'PAID')
      .reduce((sum, sale) => sum + Math.max(sale.totalAmount - sale.refundedAmount, 0), 0),
    pending: sales
      .filter((sale) => sale.status === 'PENDING' || sale.status === 'RESERVED')
      .reduce((sum, sale) => sum + sale.totalAmount, 0),
    sold: manualSales
      .filter((sale) => sale.status === 'PAID')
      .reduce((sum, sale) => sum + sale.quantity, 0),
    complimentary: manualSales
      .filter((sale) => sale.status === 'COMPLIMENTARY')
      .reduce((sum, sale) => sum + sale.quantity, 0),
  };
}
