import { NextResponse } from 'next/server';
import { z } from 'zod';

import { normalizeMetricDimensions, sharedTelemetry } from '@alusa/observability';
import { normalizeWebVitalRoute } from '@/lib/observability/web-vitals-route';

const webVitalSchema = z.object({
  name: z.enum(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB']),
  value: z.number().finite().nonnegative().max(120_000),
  rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
  route: z.string().max(256).optional(),
  navigationType: z.enum(['navigate', 'reload', 'back-forward', 'back-forward-cache', 'prerender', 'restore']).optional(),
});
const payloadSchema = z.object({ metrics: z.array(webVitalSchema).min(1).max(6) }).strict();

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return NextResponse.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413, headers: { 'cache-control': 'no-store' } });
  }
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ success: false, error: 'PAYLOAD_INVALIDO' }, { status: 422, headers: { 'cache-control': 'no-store' } });
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 8_192) {
        await reader.cancel();
        return NextResponse.json({ success: false, error: 'PAYLOAD_TOO_LARGE' }, { status: 413, headers: { 'cache-control': 'no-store' } });
      }
      chunks.push(value);
    }
  } catch {
    return NextResponse.json({ success: false, error: 'PAYLOAD_INVALIDO' }, { status: 422, headers: { 'cache-control': 'no-store' } });
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const payload = await Promise.resolve().then(() => JSON.parse(new TextDecoder().decode(bytes))).catch(() => null);
  const parsed = payloadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'PAYLOAD_INVALIDO' },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    );
  }

  for (const metric of parsed.data.metrics) {
    void sharedTelemetry.recordMetric({
      kind: 'distribution',
      name: `alusa.web.vitals.${metric.name.toLowerCase()}`,
      value: metric.value,
      unit: metric.name === 'CLS' ? 'unitless' : 'millisecond',
      dimensions: normalizeMetricDimensions({
        'web_vital.name': metric.name.toLowerCase(),
        'web_vital.rating': metric.rating ?? 'unknown',
        'http.route': metric.route ? normalizeWebVitalRoute(metric.route) : undefined,
      }),
    });
  }

  return NextResponse.json(
    { success: true },
    { headers: { 'cache-control': 'no-store' } },
  );
}
