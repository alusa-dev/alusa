import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { grantRenewalException } from '@/src/server/matriculas/renewal-governance.service';
import {
  RenewalPermissionError,
  requireRenewalPermission,
} from '@/src/server/matriculas/renewal-permissions.service';

const bodySchema = z.object({
  itemId: z.string().trim().nullable().optional(),
  permission: z.string().trim().min(3),
  rule: z.string().trim().min(3),
  impact: z.string().trim().min(3),
  justification: z.string().trim().min(8),
  expiresAt: z.string().datetime().or(z.string().date()).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('DATA_INVALIDA');
  return date;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');

  try {
    requireRenewalPermission({ role: user.role, permission: 'renewal.exception.grant' });
    const { id } = await context.params;
    const process = await prisma.rematriculaProcesso.findFirst({
      where: { id, contaId: user.contaId },
      select: { id: true, campanhaId: true },
    });
    if (!process) {
      return jsonError(404, 'REMATRICULA_NAO_ENCONTRADA', 'Processo de rematrícula não encontrado.');
    }

    const body = bodySchema.parse(await request.json().catch(() => null));
    const exception = await grantRenewalException(
      {
        contaId: user.contaId,
        actorId: user.id,
        processoId: process.id,
        campanhaId: process.campanhaId,
        itemId: body.itemId,
        permission: body.permission,
        rule: body.rule,
        impact: body.impact,
        justification: body.justification,
        expiresAt: parseDate(body.expiresAt),
        metadata: body.metadata,
      },
      { prisma },
    );

    return NextResponse.json({ exception }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof RenewalPermissionError) {
      return jsonError(403, error.code, 'Usuário não tem permissão para conceder exceções.');
    }
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }
    if (error instanceof Error && error.message === 'JUSTIFICATIVA_OBRIGATORIA') {
      return jsonError(422, 'JUSTIFICATIVA_OBRIGATORIA', 'Informe a justificativa da exceção.');
    }
    return jsonError(
      500,
      'ERRO_CONCEDER_EXCECAO',
      error instanceof Error ? error.message : 'Erro ao conceder exceção.',
    );
  }
}

