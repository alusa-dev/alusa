import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logPerfMetric } from '@/lib/perf-logger';

const webVitalSchema = z.object({
  name: z.enum(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB']),
  value: z.number(),
  rating: z.enum(['good', 'needs-improvement', 'poor']).optional(),
  id: z.string().max(128).optional(),
  route: z.string().max(256).optional(),
  navigationType: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = webVitalSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'PAYLOAD_INVALIDO' },
      { status: 422, headers: { 'cache-control': 'no-store' } },
    );
  }

  logPerfMetric('web-vitals', parsed.data.name, Math.round(parsed.data.value), {
    rating: parsed.data.rating,
    route: parsed.data.route,
    navigationType: parsed.data.navigationType,
  });

  return NextResponse.json(
    { success: true },
    { headers: { 'cache-control': 'no-store' } },
  );
}
