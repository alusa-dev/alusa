/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest';
import { registerTelemetrySink, type TelemetryMetric } from '@alusa/observability';
import { normalizeWebVitalRoute } from '@/lib/observability/web-vitals-route';
import { POST } from '@/app/api/observability/web-vitals/route';

describe('POST /api/observability/web-vitals', () => {
  let unsubscribe: (() => void) | undefined;
  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
  });

  it('ingere lote limitado de métricas normalizadas sem persistência', async () => {
    const metrics: TelemetryMetric[] = [];
    unsubscribe = registerTelemetrySink({ metric: (metric) => metrics.push(metric) });
    const response = await POST(new Request('http://localhost/api/observability/web-vitals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        metrics: [
          { name: 'LCP', value: 900, rating: 'good', route: '/alunos/123/perfil', navigationType: 'navigate' },
          { name: 'CLS', value: 0.01, rating: 'good', route: '/alunos/[id]/perfil', navigationType: 'navigate' },
        ],
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toMatchObject({ name: 'alusa.web.vitals.lcp', dimensions: { 'http.route': '/alunos' } });
  });

  it('colapsa rotas livres em categorias estáticas sem transportar segmentos pessoais', () => {
    expect(normalizeWebVitalRoute('/students/maria-silva?tab=finance')).toBe('/students');
    expect(normalizeWebVitalRoute('/maria@example.com/profile')).toBe('/other');
    expect(normalizeWebVitalRoute('/')).toBe('/');
  });

  it('rejeita lotes acima do limite e payloads maiores que 8KB', async () => {
    const tooManyMetrics = Array.from({ length: 7 }, () => ({ name: 'LCP', value: 1 }));
    const oversized = await POST(new Request('http://localhost/api/observability/web-vitals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: ' '.repeat(8_193),
    }));
    const invalidBatch = await POST(new Request('http://localhost/api/observability/web-vitals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metrics: tooManyMetrics }),
    }));
    expect(oversized.status).toBe(413);
    expect(invalidBatch.status).toBe(422);
  });
});
