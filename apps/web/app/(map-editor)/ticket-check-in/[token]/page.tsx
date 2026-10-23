import { EventTicketQrScanner } from '@/features/events/map/components/EventTicketQrScanner';

export default async function PublicEventTicketScannerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EventTicketQrScanner accessToken={token} />;
}
