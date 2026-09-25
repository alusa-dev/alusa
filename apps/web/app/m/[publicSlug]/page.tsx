import { notFound } from 'next/navigation';

import { getPublicEventMapPaymentInstruments } from '@alusa/finance';
import {
  getPublicEventMap,
  getPublicEventMapOrderStatus,
} from '@alusa/lib/events/map/event-map.service';

import { PublicMapExperience } from '@/features/events/map/public/PublicMapExperience';
import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageProps = {
  params: Promise<{ publicSlug: string }>;
  searchParams: Promise<{ orderId?: string; token?: string }>;
};

export default async function PublicEventMapPage({ params, searchParams }: PageProps) {
  const [{ publicSlug }, { orderId, token }] = await Promise.all([params, searchParams]);
  const map = await getPublicEventMap(publicSlug).catch(() => null);
  if (!map) notFound();

  let initialOrder = null;
  if (orderId || token) {
    if (!orderId || !token?.trim()) notFound();
    ensureEventAsaasPaymentProviderRegistered();
    initialOrder = await getPublicEventMapOrderStatus(orderId, token).catch(() => null);
    if (!initialOrder || initialOrder.map.publicSlug !== publicSlug) notFound();
  }
  const paymentInstruments = initialOrder?.status === 'PAYMENT_PENDING'
    ? await getPublicEventMapPaymentInstruments(orderId!, token!)
    : null;

  return (
    <PublicMapExperience
      map={map}
      initialOrder={initialOrder ? {
        orderId: initialOrder.orderId,
        accessToken: token!,
        ticketsUrl: initialOrder.ticketsUrl,
        invoiceUrl: initialOrder.invoiceUrl,
        bankSlipCode: paymentInstruments?.bankSlipInfo?.identificationField ?? null,
        bankSlipBarcode: paymentInstruments?.bankSlipInfo?.barCode ?? null,
        status: initialOrder.status,
        paymentStatus: initialOrder.paymentStatus,
        refundRequestUrl: initialOrder.refundRequestUrl,
        ticketFulfillmentStatus: initialOrder.ticketFulfillmentStatus,
        expiresAt: initialOrder.expiresAt,
        statusUrl: initialOrder.statusUrl,
        paymentMethod: initialOrder.paymentMethod === 'CREDIT_CARD'
          || initialOrder.paymentMethod === 'BOLETO'
          || initialOrder.paymentMethod === 'PIX'
          ? initialOrder.paymentMethod
          : null,
        items: initialOrder.items.map((item) => ({
          ticketCode: item.ticketCode,
          seatLabel: item.seatLabel,
          sectionName: item.sectionName,
        })),
        pixQrCode: paymentInstruments?.pixQrCode ?? null,
      } : null}
    />
  );
}
