import { EventReportDetail } from '@/features/events/reports/EventReportDetail';

export default async function EventReportDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventReportDetail eventId={eventId} />;
}
