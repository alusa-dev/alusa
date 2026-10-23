import { EventTicketQrScanner } from '@/features/events/map/components/EventTicketQrScanner';

export default async function EventTicketQrScannerPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventTicketQrScanner eventId={eventId} />;
}
