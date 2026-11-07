'use client';

import { useEffect, useRef } from 'react';
import { COOKIE_POLICY_VERSION } from '@/lib/privacy/legal-versions';
import { hasCurrentMarketingConsent, META_PIXEL_MAP_SLUGS, metaPixelPurchaseDedupeKey, shouldSendMetaPixelPurchase } from './meta-pixel';

type PixelWindow = Window & { fbq?: (...args: unknown[]) => void; _fbq?: unknown };

function ensurePixel(w: PixelWindow) {
  if (w.fbq) return w.fbq;
  const queue: unknown[][] = [];
  const fbq = ((...args: unknown[]) => { queue.push(args); }) as ((...args: unknown[]) => void) & { queue: unknown[][]; loaded?: boolean; version?: string };
  fbq.queue = queue;
  fbq.loaded = true;
  fbq.version = '2.0';
  w.fbq = fbq;
  w._fbq = fbq;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);
  fbq('init', '1081285171574725');
  return fbq;
}

export function MetaPixelTracker({
  publicSlug,
  mode,
  order,
}: {
  publicSlug: string;
  mode: 'public' | 'preview';
  order: { orderId: string; status: string; paymentStatus?: string | null; totalAmount?: number } | null;
}) {
  const pageViewSent = useRef(false);

  useEffect(() => {
    if (mode !== 'public' || !META_PIXEL_MAP_SLUGS.has(publicSlug)) return;
    const fire = () => {
      try {
        const value = JSON.parse(localStorage.getItem('alusa.cookie-consent.v1') ?? 'null');
        if (!hasCurrentMarketingConsent(value, COOKIE_POLICY_VERSION)) return;
      } catch { return; }

      const fbq = ensurePixel(window as PixelWindow);
      if (!pageViewSent.current) {
        fbq('track', 'PageView');
        pageViewSent.current = true;
      }
      if (shouldSendMetaPixelPurchase({ publicSlug, mode, orderStatus: order?.status, paymentStatus: order?.paymentStatus })
        && typeof order?.totalAmount === 'number') {
        const key = metaPixelPurchaseDedupeKey(order.orderId);
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, '1');
          fbq('track', 'Purchase', { value: order.totalAmount, currency: 'BRL' });
        }
      }
    };

    fire();
    window.addEventListener('alusa-cookie-consent-updated', fire);
    return () => window.removeEventListener('alusa-cookie-consent-updated', fire);
  }, [mode, order?.orderId, order?.paymentStatus, order?.status, order?.totalAmount, publicSlug]);

  return null;
}
