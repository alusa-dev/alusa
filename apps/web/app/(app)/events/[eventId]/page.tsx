import { EventDetailFeature } from '@/features/events/EventsFeature';

type PageProps = {
  params: Promise<{ eventId: string }>;
};

export default async function EventDetailPage({ params }: PageProps) {
  const { eventId } = await params;
  return <EventDetailFeature eventId={eventId} />;
}
