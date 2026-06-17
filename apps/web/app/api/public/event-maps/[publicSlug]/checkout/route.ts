import { NextRequest, NextResponse } from 'next/server';

import { drainFinanceWebhookSideEffectOutbox } from '@alusa/finance';
import { publicCheckoutSchema } from '@alusa/lib/events/map/event-map.schema';
import { completePublicEventMapCheckout } from '@alusa/lib/events/map/event-map.service';

import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';
import { handleEventsRouteError } from '../../../../events/_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ publicSlug: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    ensureEventAsaasPaymentProviderRegistered();
    const { publicSlug } = await params;
    const body = publicCheckoutSchema.parse(await request.json());
    const data = await completePublicEventMapCheckout(publicSlug, body);
    await drainFinanceWebhookSideEffectOutbox({ limit: 8 }).catch(() => null);
    return NextResponse.json({ data });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_CHECKOUT_MAPA_PUBLICO');
  }
}
