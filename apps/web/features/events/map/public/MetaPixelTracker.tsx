'use client';

import { useEffect, useRef } from 'react';
import { COOKIE_POLICY_VERSION } from '@/lib/privacy/legal-versions';
import { hasCurrentMarketingConsent, META_PIXEL_MAP_SLUGS, metaPixelPurchaseDedupeKey, metaPixelPurchaseEventId, shouldSendMetaPixelPurchase } from './meta-pixel';

const dispatchedPurchaseIds = new Set<string>();

type PixelWindow = Window & { fbq?: (...args: unknown[]) => void; _fbq?: unknown };
type PixelQueueStub = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void };

function ensurePixel(w: PixelWindow) {
  if (w.fbq) return w.fbq;
  const queue: unknown[][] = [];
  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, args);
    else queue.push(args);
  }) as ((...args: unknown[]) => void) & {
    queue: unknown[][];
    loaded?: boolean;
    version?: string;
    push: unknown;
    callMethod?: (...args: unknown[]) => void;
  };
  fbq.push = fbq;
  fbq.queue = queue;
  fbq.loaded = true;
  fbq.version = '2.0';
  w.fbq = fbq;
  w._fbq = fbq;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  script.onload = () => w.dispatchEvent(new Event('alusa-meta-pixel-ready'));
  script.onerror = () => {
    if (w.fbq === fbq) {
      delete w.fbq;
      delete w._fbq;
    }
    script.remove();
    w.dispatchEvent(new Event('alusa-meta-pixel-error'));
  };
  document.head.appendChild(script);
  fbq('init', '1081285171574725');
  return fbq;
}

export function MetaPixelTracker({
  publicSlug,
  mode,
  order,
  step,
}: {
  publicSlug: string;
  mode: 'public' | 'preview';
  order: { orderId: string; status: string; paymentStatus?: string | null; totalAmount?: number; metaMarketingConsentGranted?: boolean } | null;
  step: 'SELECTION' | 'IDENTIFICATION' | 'PAYMENT_METHOD' | 'CONFIRMATION';
}) {
  const pageViewSent = useRef(false);
  const viewContentSent = useRef(false);
  const initiateCheckoutSent = useRef(false);
  const pixelRetries = useRef(0);

  useEffect(() => {
    if (mode !== 'public' || !META_PIXEL_MAP_SLUGS.has(publicSlug)) return;
    const fire = () => {
      try {
        const value = JSON.parse(localStorage.getItem('alusa.cookie-consent.v1') ?? 'null');
        if (!hasCurrentMarketingConsent(value, COOKIE_POLICY_VERSION)) {
          const pixel = (window as PixelWindow).fbq;
          if (pixel) pixel('consent', 'revoke');
          return;
        }
      } catch {
        const pixel = (window as PixelWindow).fbq;
        if (pixel) pixel('consent', 'revoke');
        return;
      }

      const fbq = ensurePixel(window as PixelWindow);
      fbq('consent', 'grant');
      if (!pageViewSent.current) {
        fbq('track', 'PageView');
        pageViewSent.current = true;
      }
      if (!viewContentSent.current) {
        fbq('track', 'ViewContent', { content_type: 'product' });
        viewContentSent.current = true;
      }
      if (step !== 'SELECTION' && !initiateCheckoutSent.current) {
        fbq('track', 'InitiateCheckout');
        initiateCheckoutSent.current = true;
      }
      if (shouldSendMetaPixelPurchase({ publicSlug, mode, orderStatus: order?.status, paymentStatus: order?.paymentStatus })
        && order?.metaMarketingConsentGranted === true
        && typeof order?.totalAmount === 'number') {
        const key = metaPixelPurchaseDedupeKey(order.orderId);
        const eventId = metaPixelPurchaseEventId(order.orderId);
        if (typeof (fbq as PixelQueueStub).callMethod !== 'function') return;
        let alreadySent = dispatchedPurchaseIds.has(eventId);
        try { alreadySent ||= localStorage.getItem(key) === '1'; } catch { /* memory dedupe still applies */ }
        if (alreadySent) return;
        try {
          fbq('track', 'Purchase', { value: order.totalAmount, currency: 'BRL' }, { eventID: eventId });
          dispatchedPurchaseIds.add(eventId);
          try { localStorage.setItem(key, '1'); } catch { /* stable eventID and memory dedupe cover storage failure */ }
        } catch { /* allow a later status update to retry dispatch */ }
      }
    };

    fire();
    window.addEventListener('alusa-cookie-consent-updated', fire);
    window.addEventListener('alusa-meta-pixel-ready', fire);
    const retryPixel = () => {
      if (pixelRetries.current >= 1) return;
      pixelRetries.current += 1;
      pageViewSent.current = false;
      viewContentSent.current = false;
      initiateCheckoutSent.current = false;
      fire();
    };
    window.addEventListener('alusa-meta-pixel-error', retryPixel);
    return () => {
      window.removeEventListener('alusa-cookie-consent-updated', fire);
      window.removeEventListener('alusa-meta-pixel-ready', fire);
      window.removeEventListener('alusa-meta-pixel-error', retryPixel);
    };
  }, [mode, order?.metaMarketingConsentGranted, order?.orderId, order?.paymentStatus, order?.status, order?.totalAmount, publicSlug, step]);

  return null;
}
