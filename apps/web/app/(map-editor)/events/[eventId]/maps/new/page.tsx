import { CreateEventMapRoute } from '@/features/events/map/components/CreateEventMapRoute';

type PageProps = {
  params: Promise<{ eventId: string }>;
};

export default async function NewEventMapPage({ params }: PageProps) {
  const { eventId } = await params;
  return <CreateEventMapRoute eventId={eventId} />;
}
