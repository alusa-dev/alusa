import { NextResponse } from 'next/server';

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return json(404, { error: 'NOT_FOUND' });
  }

  return json(200, {
    hasAsaasBaseUrl: Boolean(process.env.ASAAS_BASE_URL),
    hasAsaasApiKey: Boolean(process.env.ASAAS_API_KEY),
    hasAsaasWebhookAuthTokenSecret: Boolean(process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET),
    hasAsaasWebhookPublicBaseUrl: Boolean(process.env.ASAAS_WEBHOOK_PUBLIC_BASE_URL),
    hasNextPublicAppUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    hasNextAuthUrl: Boolean(process.env.NEXTAUTH_URL),
  });
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
