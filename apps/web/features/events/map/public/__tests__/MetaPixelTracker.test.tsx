import { act, cleanup, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
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

function tracker(order: ComponentProps<typeof MetaPixelTracker>['order'] = null, step: ComponentProps<typeof MetaPixelTracker>['step'] = 'SELECTION') {
  return <MetaPixelTracker publicSlug={slug} mode="public" order={order} step={step} />;
}

describe('MetaPixelTracker', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    delete (window as Window & { fbq?: unknown; _fbq?: unknown }).fbq;
    delete (window as Window & { fbq?: unknown; _fbq?: unknown })._fbq;
    document.querySelectorAll('script[src="https://connect.facebook.net/en_US/fbevents.js"]').forEach((script) => script.remove());
  });

  it('suppresses the pixel when consent is missing or marketing is rejected', () => {
    const missing = render(tracker());
    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toBeNull();
    missing.unmount();

    saveConsent(false);
    render(tracker());
    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toBeNull();
    expect(trackedCalls()).toHaveLength(0);
  });

  it('fires PageView after consent is accepted after mount', () => {
    render(tracker(null, 'PAYMENT_METHOD'));
    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toBeNull();

    act(() => {
      saveConsent(true);
      window.dispatchEvent(new CustomEvent('alusa-cookie-consent-updated'));
    });

    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).not.toBeNull();
    expect(trackedCalls()).toContainEqual(['track', 'PageView']);
    expect(trackedCalls()).toContainEqual(['track', 'ViewContent', { content_type: 'product' }]);
    expect(trackedCalls().filter((call) => call[1] === 'InitiateCheckout')).toHaveLength(1);
  });

  it('routes calls through fbevents callMethod once the library replaces the queue stub', () => {
    saveConsent(true);
    render(tracker());
    const pixel = window as Window & { fbq?: ((...args: unknown[]) => void) & { queue?: unknown[][]; callMethod?: (...args: unknown[]) => void } };
    const queue = pixel.fbq!.queue!;
    const method = vi.fn();
    pixel.fbq!.callMethod = method;
    act(() => pixel.fbq!('track', 'ViewContent', { content_type: 'product' }));
    expect(method).toHaveBeenCalledWith('track', 'ViewContent', { content_type: 'product' });
    expect(queue.filter((call) => call[1] === 'ViewContent')).toHaveLength(1);
  });

  it('fires one BRL Purchase only after confirmed paid status, including across remounts', () => {
    saveConsent(true);
    const order = { orderId: 'order-paid', status: 'PAYMENT_PENDING', paymentStatus: 'PENDING', totalAmount: 125.5 };
    const view = render(tracker(order, 'IDENTIFICATION'));
    expect(trackedCalls().filter((call) => call[1] === 'InitiateCheckout')).toHaveLength(1);
    expect(trackedCalls().filter((call) => call[1] === 'Purchase')).toHaveLength(0);

    const pixel = window as Window & { fbq?: ((...args: unknown[]) => void) & { queue?: unknown[][]; callMethod?: (...args: unknown[]) => void } };
    const method = vi.fn();
    pixel.fbq!.callMethod = method;
    const paidOrder = { ...order, status: 'CONFIRMED', paymentStatus: 'RECEIVED' };
    view.rerender(tracker(paidOrder, 'CONFIRMATION'));
    view.rerender(tracker(paidOrder, 'CONFIRMATION'));
    expect(method.mock.calls.filter((call) => call[1] === 'Purchase')).toEqual([['track', 'Purchase', { value: 125.5, currency: 'BRL' }, { eventID: 'alusa_purchase_order-paid' }]]);

    view.unmount();
    render(tracker(paidOrder, 'CONFIRMATION'));
    expect(method.mock.calls.filter((call) => call[1] === 'Purchase')).toHaveLength(1);
  });

  it('dispatches a paid Purchase when storage writes fail and keeps an in-memory dedupe', () => {
    saveConsent(true);
    const paidOrder = { orderId: 'order-storage-failure', status: 'CONFIRMED', paymentStatus: 'RECEIVED', totalAmount: 45 };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    const view = render(tracker(paidOrder, 'CONFIRMATION'));
    const pixel = window as Window & { fbq?: ((...args: unknown[]) => void) & { queue?: unknown[][]; callMethod?: (...args: unknown[]) => void } };
    const method = vi.fn();
    pixel.fbq!.callMethod = method;
    act(() => window.dispatchEvent(new Event('alusa-meta-pixel-ready')));
    view.rerender(tracker(paidOrder, 'CONFIRMATION'));
    expect(method.mock.calls.filter((call) => call[1] === 'Purchase')).toHaveLength(1);
  });

  it('waits for callMethod before marking Purchase sent, retries one script failure, then dispatches after recovery', () => {
    saveConsent(true);
    const paidOrder = { orderId: 'order-pixel-recovery', status: 'CONFIRMED', paymentStatus: 'RECEIVED', totalAmount: 72 };
    render(tracker(paidOrder, 'CONFIRMATION'));
    const key = 'alusa.meta-pixel.purchase.order-pixel-recovery';
    expect(trackedCalls().filter((call) => call[1] === 'Purchase')).toHaveLength(0);
    expect(localStorage.getItem(key)).toBeNull();

    const firstScript = document.querySelector<HTMLScriptElement>('script[src="https://connect.facebook.net/en_US/fbevents.js"]')!;
    act(() => firstScript.dispatchEvent(new Event('error')));
    const retryScript = document.querySelector<HTMLScriptElement>('script[src="https://connect.facebook.net/en_US/fbevents.js"]')!;
    expect(retryScript).not.toBe(firstScript);
    expect(trackedCalls().filter((call) => call[1] === 'InitiateCheckout')).toHaveLength(1);
    const pixel = window as Window & { fbq?: ((...args: unknown[]) => void) & { queue?: unknown[][]; callMethod?: (...args: unknown[]) => void } };
    const method = vi.fn();
    pixel.fbq!.callMethod = method;
    act(() => retryScript.dispatchEvent(new Event('load')));
    expect(method).toHaveBeenCalledWith('track', 'Purchase', { value: 72, currency: 'BRL' }, { eventID: 'alusa_purchase_order-pixel-recovery' });
    expect(localStorage.getItem(key)).toBe('1');
    expect(trackedCalls().filter((call) => call[1] === 'Purchase')).toHaveLength(0);
  });

  it('does not send Purchase when cookie marketing consent exists but the order opt-in is absent', () => {
    saveConsent(true);
    render(tracker({
      orderId: 'order-no-meta-consent',
      status: 'CONFIRMED',
      paymentStatus: 'RECEIVED',
      totalAmount: 80,
      metaMarketingConsentGranted: false,
    }));
    expect(trackedCalls().filter((call) => call[1] === 'Purchase')).toHaveLength(0);
    expect(trackedCalls()).toContainEqual(['track', 'PageView']);
  });
});
