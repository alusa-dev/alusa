import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { drainStripeWebhookWorker } from '@/src/server/platform-billing/webhook-worker';

export const runtime = 'nodejs';

const drainSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: NextRequest) {
  const authorized = await isAuthorizedWorkerRequest(req);
  if (!authorized) return NextResponse.json({ error: 'SEM_PERMISSAO' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = drainSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await drainStripeWebhookWorker({
    prisma,
    limit: parsed.data.limit,
  });

  return NextResponse.json(result);
}

async function isAuthorizedWorkerRequest(req: NextRequest): Promise<boolean> {
  const secret = process.env.PLATFORM_BILLING_WORKER_SECRET?.trim();
  if (secret) {
    return req.headers.get('x-platform-billing-worker-secret') === secret;
  }

  const session = await getServerSession(authOptions);
  const role = (session as { user?: { role?: string } } | null)?.user?.role;
  return String(role ?? '').toUpperCase() === 'ADMIN';
}
