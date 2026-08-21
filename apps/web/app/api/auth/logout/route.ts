import { NextRequest } from 'next/server';
import { clearAuthCookies } from '@/lib/auth-cookies';
import { jsonNoStore } from '@/lib/http-security';

function hasTrustedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const expectedOrigin = req.nextUrl.origin;

  try {
    return new URL(origin ?? '').origin === expectedOrigin && new URL(referer ?? '').origin === expectedOrigin;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!hasTrustedOrigin(req)) {
    return jsonNoStore({ ok: false, error: 'Origem da requisição não permitida.' }, { status: 403 });
  }

  const response = jsonNoStore({ ok: true });
  // Logout individual somente remove as credenciais deste navegador. A
  // revogação global é uma operação explícita e separada.
  return clearAuthCookies(response, req.headers.get('cookie'));
}
