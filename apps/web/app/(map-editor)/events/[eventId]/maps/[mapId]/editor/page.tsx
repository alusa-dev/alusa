import { EventMapEditor } from '@/features/events/map/components/EventMapEditor';

type PageProps = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export default async function EventMapEditorPage({ params }: PageProps) {
  const { eventId, mapId } = await params;
  return <EventMapEditor eventId={eventId} mapId={mapId} />;
}
