import { notFound } from 'next/navigation';

import { getPublicEventMapOrderTickets } from '@alusa/lib/events/map/event-map.service';

import { PublicOrderTicketsHtmlPage } from '@/features/events/map/public/PublicOrderTicketsHtmlPage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageProps = {
  params: Promise<{ publicSlug: string; orderId: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default async function PublicEventMapOrderTicketsPage({ params, searchParams }: PageProps) {
  const { publicSlug, orderId } = await params;
  const { token } = await searchParams;
  if (!token?.trim()) notFound();

  const order = await getPublicEventMapOrderTickets(orderId, token).catch(() => null);
  if (!order) notFound();
  if (order.map.publicSlug !== publicSlug) notFound();

  return <PublicOrderTicketsHtmlPage order={order} token={token} />;
}
