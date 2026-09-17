import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  rematriculaProcessCommunicationInputDTOSchema,
  rematriculaProcessRouteParamsDTOSchema,
} from '@/features/cadastro/rematriculas/dtos';
import { createRenewalCommunicationForTenant } from '@/src/server/matriculas/renewal-http.service';
import {
  RenewalPermissionError,
  requireRenewalPermission,
} from '@/src/server/matriculas/renewal-permissions.service';

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
  const auth = await resolveTenantSession();
  if (!auth.ok) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!auth.role) return jsonError(403, 'SEM_PERMISSAO', 'Usuário não tem permissão para comunicação de rematrícula.');

  try {
    requireRenewalPermission({ role: auth.role, permission: 'renewal.campaign.manage' });
    const { id } = rematriculaProcessRouteParamsDTOSchema.parse(await context.params);
    const body = rematriculaProcessCommunicationInputDTOSchema.parse(await request.json().catch(() => null));
    const result = await createRenewalCommunicationForTenant(
      {
        contaId: auth.contaId,
        actorId: auth.userId,
        processoId: id,
        participanteId: body.participanteId,
        channel: body.channel,
        audience: body.audience,
        subject: body.subject,
        message: body.message,
        scheduledAt: parseDate(body.scheduledAt),
        payload: body.payload,
      },
    );
    if (!result) return jsonError(404, 'REMATRICULA_NAO_ENCONTRADA', 'Processo de rematrícula não encontrado.');

    return NextResponse.json(
      { communication: result.communication },
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
      'Erro ao criar comunicação.',
    );
  }
}
