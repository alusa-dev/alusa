import { NextRequest, NextResponse } from 'next/server';
import { expertContactLeadInputDTOSchema } from '@/features/public/dtos';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { HubSpotExpertContactError, submitExpertContactLeadToHubSpot } from '@/src/server/public/hubspot-expert-contact';

const route = '/api/public/expert-contact';

export async function POST(request: NextRequest) {
  const requestIp = ipFromRequest(request);
  const rate = await rateLimitAsync(`public:expert-contact:${requestIp}`, 5, 10 * 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: 'Tente novamente em alguns minutos.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = expertContactLeadInputDTOSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 422 });

  // Honeypot: bots get a neutral response and their data is never sent.
  if (parsed.data.website?.trim()) return NextResponse.json({ success: true }, { status: 202 });

  const requestId = getRequestId(request);
  try {
    await submitExpertContactLeadToHubSpot(parsed.data);
    return NextResponse.json({ success: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const knownError = error instanceof HubSpotExpertContactError ? error : null;
    logApiOperationalEvent({
      severity: knownError?.code === 'not_configured' ? 'warn' : 'error',
      eventName: 'api.public.expert_contact.delivery_failed',
      route,
      method: 'POST',
      requestId,
      error: knownError ?? error,
      result: knownError?.code ?? 'unexpected_error',
    });

    if (knownError?.code === 'not_configured') {
      return NextResponse.json(
        { error: 'CONTACT_DELIVERY_UNAVAILABLE', message: 'O envio pelo formulário está temporariamente indisponível. Seus dados continuam preenchidos; tente novamente ou fale com a equipe pelo WhatsApp.' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
      );
    }

    if (knownError?.code === 'ambiguous') {
      return NextResponse.json(
        { error: 'CONTACT_DELIVERY_REQUIRES_RECONCILIATION', message: 'Recebemos seus dados, mas não foi possível confirmar o registro no CRM. Para evitar um envio duplicado, não envie o formulário novamente; nossa equipe pode continuar o atendimento pelo WhatsApp.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (knownError?.code === 'idempotency_conflict') {
      return NextResponse.json(
        { error: 'REQUEST_ID_CONFLICT', message: 'Este envio já foi recebido com outros dados. Atualize a página antes de tentar novamente.' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const timedOut = knownError?.code === 'timeout';
    return NextResponse.json(
      { error: 'CONTACT_DELIVERY_FAILED', message: 'Não foi possível confirmar o envio. Seus dados continuam preenchidos; tente novamente ou fale com a equipe pelo WhatsApp.' },
      { status: timedOut ? 504 : 502, headers: { 'Cache-Control': 'no-store', ...(timedOut ? { 'Retry-After': '5' } : {}) } },
    );
  }
}
