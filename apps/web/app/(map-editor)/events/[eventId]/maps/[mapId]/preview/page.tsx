import { getEventMap } from '@alusa/lib/events/map/event-map.service';

import { getEventsContext } from '@/app/api/events/_helpers';
import { PublicMapExperience } from '@/features/events/map/public/PublicMapExperience';
import { buildPreviewPublicMap } from '@/features/events/map/public/public-map-adapter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageProps = {
  params: Promise<{ eventId: string; mapId: string }>;
};

export default async function EventMapPreviewPage({ params }: PageProps) {
  const { eventId, mapId } = await params;
  const ctx = await getEventsContext('eventMaps.view');
  const map = await getEventMap(ctx, eventId, mapId);

  return <PublicMapExperience map={buildPreviewPublicMap(map)} mode="preview" />;
}
