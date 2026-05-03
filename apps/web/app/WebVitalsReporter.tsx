'use client';

import { useReportWebVitals } from 'next/web-vitals';

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const body = JSON.stringify({
      id: metric.id,
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: metric.navigationType,
      route: window.location.pathname,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/observability/web-vitals', body);
      return;
    }

    fetch('/api/observability/web-vitals', {
      method: 'POST',
      body,
      keepalive: true,
      headers: { 'content-type': 'application/json' },
    }).catch(() => {});
  });

  return null;
}
