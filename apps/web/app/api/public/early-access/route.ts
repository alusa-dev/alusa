import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { prisma } from '@/src/prisma';

const earlyAccessSchema = z.object({
  institutionName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  role: z.string().trim().max(100).optional().or(z.literal('')),
  email: z.string().trim().toLowerCase().email().max(180),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  studentsRange: z.string().trim().max(40).optional().or(z.literal('')),
  mainChallenge: z.string().trim().max(500).optional().or(z.literal('')),
  website: z.string().max(0).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const requestIp = ipFromRequest(request);
  const rate = await rateLimitAsync(`public:early-access:${requestIp}`, 5, 10 * 60_000);

  if (!rate.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Tente novamente em alguns minutos.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = earlyAccessSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 422 });
  }

  // Honeypot: respostas automatizadas recebem sucesso neutro, sem persistência.
  if (parsed.data.website?.trim()) {
    return NextResponse.json({ success: true });
  }

  const leadData = { ...parsed.data };
  delete leadData.website;
  await prisma.earlyAccessLead.upsert({
    where: { email: leadData.email },
    create: leadData,
    update: leadData,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
