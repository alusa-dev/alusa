import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

import prisma from '@/lib/prisma';
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
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
  const userId = typeof token?.id === 'string' ? token.id : typeof token?.sub === 'string' ? token.sub : null;

  if (!userId) {
    return clearAuthCookies(response, req.headers.get('cookie'));
  }

  try {
    // A versão é conferida em toda revalidação da sessão; um JWT copiado deixa
    // de ser aceito imediatamente após este incremento.
    await prisma.usuario.updateMany({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    });
  } catch {
    return jsonNoStore({ ok: false, error: 'Não foi possível revogar a sessão.' }, { status: 503 });
  }

  return clearAuthCookies(response, req.headers.get('cookie'));
}
