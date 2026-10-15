import { EventReportsIndex } from '@/features/events/reports/EventReportsIndex';
import TableLayout from '@/components/layout/TableLayout';

export default function EventReportsPage() {
  return (
    <TableLayout
      title="Relatórios de eventos"
      subtitle="Encontre um evento e acompanhe sua operação, bilheteria e movimentação financeira."
      className="alusa-dashboard-page"
    >
      <EventReportsIndex />
    </TableLayout>
  );
}
