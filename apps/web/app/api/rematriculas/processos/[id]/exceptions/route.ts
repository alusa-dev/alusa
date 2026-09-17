import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  rematriculaProcessExceptionInputDTOSchema,
  rematriculaProcessRouteParamsDTOSchema,
} from '@/features/cadastro/rematriculas/dtos';
import { grantRenewalExceptionForTenant } from '@/src/server/matriculas/renewal-http.service';
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
  if (!auth.role) return jsonError(403, 'SEM_PERMISSAO', 'Usuário não tem permissão para conceder exceções.');

  try {
    requireRenewalPermission({ role: auth.role, permission: 'renewal.exception.grant' });
    const { id } = rematriculaProcessRouteParamsDTOSchema.parse(await context.params);
    const body = rematriculaProcessExceptionInputDTOSchema.parse(await request.json().catch(() => null));
    const result = await grantRenewalExceptionForTenant(
      {
        contaId: auth.contaId,
        actorId: auth.userId,
        processoId: id,
        itemId: body.itemId,
        permission: body.permission,
        rule: body.rule,
        impact: body.impact,
        justification: body.justification,
        expiresAt: parseDate(body.expiresAt),
        metadata: body.metadata,
      },
    );
    if (!result) return jsonError(404, 'REMATRICULA_NAO_ENCONTRADA', 'Processo de rematrícula não encontrado.');

    return NextResponse.json({ exception: result.exception }, { status: 201, headers: { 'cache-control': 'no-store' } });
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
      'Erro ao conceder exceção.',
    );
  }
}
