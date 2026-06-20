import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { createRenewalCommunication } from '@/src/server/matriculas/renewal-governance.service';
import {
  RenewalPermissionError,
  requireRenewalPermission,
} from '@/src/server/matriculas/renewal-permissions.service';

const bodySchema = z.object({
  participanteId: z.string().trim().nullable().optional(),
  channel: z.enum(['EMAIL', 'WHATSAPP', 'SMS', 'PORTAL']),
  audience: z.string().trim().min(2),
  subject: z.string().trim().nullable().optional(),
  message: z.string().trim().min(3),
  scheduledAt: z.string().datetime().or(z.string().date()).nullable().optional(),
  payload: z.record(z.unknown()).nullable().optional(),
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
    requireRenewalPermission({ role: user.role, permission: 'renewal.campaign.manage' });
    const { id } = await context.params;
    const process = await prisma.rematriculaProcesso.findFirst({
      where: { id, contaId: user.contaId },
      select: { id: true, campanhaId: true },
    });
    if (!process) {
      return jsonError(404, 'REMATRICULA_NAO_ENCONTRADA', 'Processo de rematrícula não encontrado.');
    }

    const body = bodySchema.parse(await request.json().catch(() => null));
    const communication = await createRenewalCommunication(
      {
        contaId: user.contaId,
        actorId: user.id,
        processoId: process.id,
        campanhaId: process.campanhaId,
        participanteId: body.participanteId,
        channel: body.channel,
        audience: body.audience,
        subject: body.subject,
        message: body.message,
        scheduledAt: parseDate(body.scheduledAt),
        payload: body.payload,
      },
      { prisma },
    );

    return NextResponse.json(
      { communication },
      { status: 201, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof RenewalPermissionError) {
      return jsonError(403, error.code, 'Usuário não tem permissão para comunicação de rematrícula.');
    }
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }
    if (error instanceof Error && error.message === 'MENSAGEM_OBRIGATORIA') {
      return jsonError(422, 'MENSAGEM_OBRIGATORIA', 'Informe a mensagem.');
    }
    return jsonError(
      500,
      'ERRO_CRIAR_COMUNICACAO',
      error instanceof Error ? error.message : 'Erro ao criar comunicação.',
    );
  }
}

