import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { encerrarContaAlusa, type CloseAccountErrorCode } from '@alusa/finance';
import {
  closeContaErrorResultDTOSchema,
  closeContaInputDTOSchema,
  closeContaSuccessResultDTOSchema,
} from '@/features/conta/dtos';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function mapErrorStatus(code: CloseAccountErrorCode): number {
  switch (code) {
    case 'CONFIRM_TEXT_INVALID':
    case 'REMOVE_REASON_REQUIRED':
      return 422;
    case 'LOCK_NOT_ACQUIRED':
      return 409;
    case 'FORBIDDEN':
    case 'NOT_FOUND':
      return 403;
    default:
      return 500;
  }
}

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (!forwarded) return null;
  return forwarded.split(',')[0]?.trim() ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; role?: string; contaId?: string };
    const user = (session as { user?: SessUser } | null)?.user;

    if (!user?.contaId || !user?.id) {
      return json(401, { message: 'Acesso negado.' });
    }

    const parsed = closeContaInputDTOSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return json(422, closeContaErrorResultDTOSchema.parse({ message: 'Payload inválido.' }));
    }

    const result = await encerrarContaAlusa({
      contaId: user.contaId,
      confirmText: parsed.data.confirmText,
      reason: parsed.data.reason,
      actor: {
        type: user.role?.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER',
        id: user.id,
        role: user.role,
      },
      requestId:
        req.headers.get('x-request-id') ?? req.headers.get('x-correlation-id') ?? undefined,
      ip: getClientIp(req),
    });

    if (result.success) {
      return json(
        200,
        closeContaSuccessResultDTOSchema.parse({
          result: result.result,
          message: result.message,
        }),
      );
    }

    const status = mapErrorStatus(result.errorCode);
    return json(status, closeContaErrorResultDTOSchema.parse({ message: result.message }));
  } catch (error) {
    console.error('[API conta/excluir][POST] Erro', error);
    return json(
      500,
      closeContaErrorResultDTOSchema.parse({ message: 'Erro interno ao encerrar conta.' }),
    );
  }
}
