'use client';

import { useEffect, useRef } from 'react';
import { useReportWebVitals } from 'next/web-vitals';
import { shouldSampleMetric } from '@/lib/observability/sampling';
import { normalizeWebVitalRoute } from '@/lib/observability/web-vitals-route';

type WebVital = {
  name: string;
  value: number;
  rating: string;
  navigationType?: string;
  route: string;
};

export function WebVitalsReporter() {
  const pending = useRef(new Map<string, WebVital>());
  const sampledSession = useRef<boolean | null>(null);

  useEffect(() => {
    const flush = () => {
      if (pending.current.size === 0) return;
      const metrics = [...pending.current.values()].slice(0, 6);
      pending.current.clear();
      const body = new Blob([JSON.stringify({ metrics })], { type: 'application/json' });

      if (navigator.sendBeacon?.('/api/observability/web-vitals', body)) return;
      fetch('/api/observability/web-vitals', {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
      }).catch(() => {});
    };

    const interval = window.setInterval(flush, 15_000);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
    };
  }, []);

  useReportWebVitals((metric) => {
    sampledSession.current ??= shouldSampleMetric(process.env.NEXT_PUBLIC_OBSERVABILITY_METRIC_SAMPLE_RATE);
    if (!sampledSession.current) return;
    pending.current.set(metric.name, {
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: metric.navigationType,
      route: normalizeWebVitalRoute(window.location.pathname),
    });
  });

  return null;
}
