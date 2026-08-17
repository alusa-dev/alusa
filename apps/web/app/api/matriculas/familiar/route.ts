import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import {
  executeCreateFamilyEnrollment,
} from '@/src/server/matriculas/create-family-enrollment.use-case';
import { createMatriculaFamiliarInputSchema } from '@/src/server/matriculas/family-enrollment.schema';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  }
  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return jsonError(
      403,
      'PERMISSAO_NEGADA',
      'Usuário não tem permissão para matricular famílias.',
    );
  }

  const raw = await request.json().catch(() => null);
  const parsed = createMatriculaFamiliarInputSchema.safeParse(raw);
  if (!parsed.success) {
    const error = parsed.error;
    return jsonError(
      400,
      'PAYLOAD_INVALIDO',
      error.issues[0]?.message ?? 'Payload inválido.',
      error instanceof z.ZodError ? error.issues : undefined,
    );
  }

  const contaId = parsed.data.contaId?.trim() || user.contaId;
  if (contaId !== user.contaId) {
    return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
  }

  try {
    await assertPlatformAccessForConta({ contaId, capability: 'ENROLLMENT_WRITE' });
  } catch (error) {
    const blocked = platformBillingAccessResponse(error);
    if (blocked) return jsonError(blocked.status, blocked.body.error, blocked.body.message, blocked.body.details);
    throw error;
  }

  return executeCreateFamilyEnrollment({
    body: parsed.data,
    actor: { id: user.id, contaId: user.contaId },
    contaId,
  });
}
