import { NextRequest, NextResponse } from 'next/server';

import { publicCheckoutSchema } from '@alusa/lib/events/map/event-map.schema';
import { completePublicEventMapCheckout } from '@alusa/lib/events/map/event-map.service';

import { handleEventsRouteError } from '../../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ publicSlug: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { publicSlug } = await params;
    const body = publicCheckoutSchema.parse(await request.json());
    return NextResponse.json({ data: await completePublicEventMapCheckout(publicSlug, body) });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CHECKOUT_MAPA_PUBLICO');
  }
}
