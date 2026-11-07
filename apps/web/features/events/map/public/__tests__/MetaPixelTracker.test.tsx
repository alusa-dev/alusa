import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOKIE_POLICY_VERSION } from '@/lib/privacy/legal-versions';
import { MetaPixelTracker } from '../MetaPixelTracker';

const slug = 'map_58c37147e01c496f92bc6f5f';
const consentKey = 'alusa.cookie-consent.v1';

function saveConsent(marketing: boolean) {
  localStorage.setItem(consentKey, JSON.stringify({
    policyVersion: COOKIE_POLICY_VERSION,
    categories: { essential: true, analytics: false, marketing, preferences: false },
    decidedAt: new Date().toISOString(),
  }));
}

function trackedCalls() {
  const pixel = window as Window & { fbq?: ((...args: unknown[]) => void) & { queue?: unknown[][] } };
  return pixel.fbq?.queue ?? [];
}

describe('MetaPixelTracker', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    cleanup();
    localStorage.clear();
    delete (window as Window & { fbq?: unknown; _fbq?: unknown }).fbq;
    delete (window as Window & { fbq?: unknown; _fbq?: unknown })._fbq;
    document.querySelectorAll('script[src="https://connect.facebook.net/en_US/fbevents.js"]').forEach((script) => script.remove());
  });

  it('suppresses the pixel when consent is missing or marketing is rejected', () => {
    const missing = render(<MetaPixelTracker publicSlug={slug} mode="public" order={null} />);
    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toBeNull();
    missing.unmount();

    saveConsent(false);
    render(<MetaPixelTracker publicSlug={slug} mode="public" order={null} />);
    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toBeNull();
    expect(trackedCalls()).toHaveLength(0);
  });

  it('fires PageView after consent is accepted after mount', () => {
    render(<MetaPixelTracker publicSlug={slug} mode="public" order={null} />);
    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toBeNull();

    act(() => {
      saveConsent(true);
      window.dispatchEvent(new CustomEvent('alusa-cookie-consent-updated'));
    });

    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).not.toBeNull();
    expect(trackedCalls()).toContainEqual(['track', 'PageView']);
  });

  it('fires one BRL Purchase only after confirmed paid status, including across remounts', () => {
    saveConsent(true);
    const order = { orderId: 'order-paid', status: 'PAYMENT_PENDING', paymentStatus: 'PENDING', totalAmount: 125.5 };
    const view = render(<MetaPixelTracker publicSlug={slug} mode="public" order={order} />);
    expect(trackedCalls().filter((call) => call[1] === 'Purchase')).toHaveLength(0);

    view.rerender(<MetaPixelTracker publicSlug={slug} mode="public" order={{ ...order, status: 'CONFIRMED', paymentStatus: 'RECEIVED' }} />);
    view.rerender(<MetaPixelTracker publicSlug={slug} mode="public" order={{ ...order, status: 'CONFIRMED', paymentStatus: 'RECEIVED' }} />);
    expect(trackedCalls().filter((call) => call[1] === 'Purchase')).toEqual([
      ['track', 'Purchase', { value: 125.5, currency: 'BRL' }],
    ]);

    view.unmount();
    render(<MetaPixelTracker publicSlug={slug} mode="public" order={{ ...order, status: 'CONFIRMED', paymentStatus: 'RECEIVED' }} />);
    expect(trackedCalls().filter((call) => call[1] === 'Purchase')).toHaveLength(1);
  });
});
