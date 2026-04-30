import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { loadAndValidateSubaccountKey } from '@alusa/lib';
import { AsaasHttpError, getCustomer } from '@alusa/asaas';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const customerSchema = z.object({
  customerId: z.string().min(8).regex(/^cus_[A-Za-z0-9]+$/),
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function statusMessage(status: number): string {
  if (status === 404) return 'Customer não encontrado na subconta.';
  if (status === 401 || status === 403) return 'Chave inválida ou sem permissão para a subconta.';
  if (status === 400) return 'CustomerId inválido.';
  return 'Falha ao consultar customer no Asaas.';
}

function mapKeyErrorToHttpStatus(code: string): number {
  switch (code) {
    case 'MISSING_KEY':
    case 'DECRYPT_FAILED':
      return 412;
    case 'INVALID_KEY':
      return 401;
    case 'TEMPORARY_ERROR':
      return 503;
    default:
      return 500;
  }
}

export async function POST(req: NextRequest) {
  let endpoint: string | null = null;
  try {
    const session = await getSessionUser();
    if (!session) return json(401, { ok: false, error: 'Não autenticado.' });

    const role = String(session.role || '').toUpperCase();
    if (role !== 'ADMIN') return json(403, { ok: false, error: 'Acesso negado.' });

    const payload = await req.json().catch(() => null);
    const parsed = customerSchema.safeParse(payload);
    if (!parsed.success) {
      const message = parsed.error.issues?.[0]?.message ?? 'Payload inválido.';
      return json(400, { ok: false, error: message });
    }

    const { customerId } = parsed.data;
    endpoint = `/v3/customers/${customerId}`;

    const keyResult = await loadAndValidateSubaccountKey(session.contaId);
    if (!keyResult.ok) {
      const status = mapKeyErrorToHttpStatus(keyResult.code);
      return json(status, {
        ok: false,
        status,
        endpoint,
        error: keyResult.message,
        code: keyResult.code,
      });
    }

    const customer = await getCustomer({
      apiKey: keyResult.apiKey,
      customerId,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return json(200, {
      ok: true,
      status: 200,
      endpoint,
      data: customer,
    });
  } catch (error) {
    if (error instanceof AsaasHttpError) {
      const status = error.status || 500;
      const response = error.responseBody ?? error.response ?? null;
      const message = statusMessage(status);
      return json(status, {
        ok: false,
        status,
        endpoint,
        error: message,
        details: response,
      });
    }

    return json(500, { ok: false, error: 'Erro interno ao consultar customer.' });
  }
}
