import { notFound } from 'next/navigation';

import { getPublicEventMap } from '@alusa/lib/events/map/event-map.service';

import { PublicMapExperience } from '@/features/events/map/public/PublicMapExperience';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageProps = {
  params: Promise<{ publicSlug: string }>;
};

export default async function PublicEventMapPage({ params }: PageProps) {
  const { publicSlug } = await params;
  const map = await getPublicEventMap(publicSlug).catch(() => null);
  if (!map) notFound();

  return <PublicMapExperience map={map} />;
}
