import { NextRequest, NextResponse } from 'next/server';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { earlyAccessLeadInputDTOSchema } from '@/features/public/dtos';
import { upsertEarlyAccessLead } from '@/src/server/public/early-access.service';

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
  const parsed = earlyAccessLeadInputDTOSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 422 });
  }

  // Honeypot: respostas automatizadas recebem sucesso neutro, sem persistência.
  if (parsed.data.website?.trim()) {
    return NextResponse.json({ success: true });
  }

  const leadData = { ...parsed.data };
  delete leadData.website;
  const marketingConsentAudit = {
    marketingConsentAt: new Date(),
    marketingConsentIp: requestIp,
    marketingConsentUserAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
  };
  await upsertEarlyAccessLead({
    lead: leadData,
    ...marketingConsentAudit,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
