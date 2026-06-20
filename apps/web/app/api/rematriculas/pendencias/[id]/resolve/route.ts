import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { resolveRenewalPending } from '@/src/server/matriculas/renewal-governance.service';
import {
  RenewalPermissionError,
  requireRenewalPermission,
} from '@/src/server/matriculas/renewal-permissions.service';

const bodySchema = z.object({
  resolution: z.string().trim().min(5),
  status: z.enum(['RESOLVED', 'DISMISSED']).optional(),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');

  try {
    requireRenewalPermission({ role: user.role, permission: 'renewal.pending.resolve' });
    const params = await context.params;
    const body = bodySchema.parse(await request.json().catch(() => null));
    const pending = await resolveRenewalPending(
      {
        contaId: user.contaId,
        pendingId: params.id,
        actorId: user.id,
        resolution: body.resolution,
        status: body.status,
      },
      { prisma },
    );
    return NextResponse.json({ pending }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof RenewalPermissionError) {
      return jsonError(403, error.code, 'Usuário não tem permissão para resolver pendências.');
    }
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }
    if (error instanceof Error && error.message === 'PENDENCIA_NAO_ENCONTRADA') {
      return jsonError(404, 'PENDENCIA_NAO_ENCONTRADA', 'Pendência não encontrada.');
    }
    if (error instanceof Error && error.message === 'RESOLUCAO_OBRIGATORIA') {
      return jsonError(422, 'RESOLUCAO_OBRIGATORIA', 'Informe a resolução da pendência.');
    }
    return jsonError(
      500,
      'ERRO_RESOLVER_PENDENCIA',
      error instanceof Error ? error.message : 'Erro ao resolver pendência.',
    );
  }
}

