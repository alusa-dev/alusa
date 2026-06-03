import { notFound } from 'next/navigation';

import { getPublicEventMapOrderStatus } from '@alusa/lib/events/map/event-map.service';

import { PublicOrderStatusPage } from '@/features/events/map/public/PublicOrderStatusPage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageProps = {
  params: Promise<{ publicSlug: string; orderId: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default async function PublicEventMapOrderPage({ params, searchParams }: PageProps) {
  const { publicSlug, orderId } = await params;
  const { token } = await searchParams;
  if (!token?.trim()) notFound();

  const order = await getPublicEventMapOrderStatus(orderId, token).catch(() => null);
  if (!order) notFound();
  if (order.map.publicSlug !== publicSlug) notFound();

  return <PublicOrderStatusPage initialOrder={order} token={token} />;
}
