export type SiteEvent =
  | 'hero_cta_clicked'
  | 'sales_cta_clicked'
  | 'nav_item_clicked'
  | 'contact_cta_clicked';

type EventPayload = Record<string, string | number | boolean | null>;

export function trackSiteEvent(event: SiteEvent, payload: EventPayload = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent('alusa:site-event', {
      detail: {
        event,
        payload,
        timestamp: new Date().toISOString()
      }
    })
  );
}
