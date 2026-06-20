import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { updateRenewalCampaign } from '@/src/server/matriculas/renewal-management.service';
import { hasRenewalPermission } from '@/src/server/matriculas/renewal-permissions.service';

const updateSchema = z.object({
  nome: z.string().trim().min(2).optional(),
  descricao: z.string().trim().nullable().optional(),
  targetPeriodId: z.string().trim().min(1).optional(),
  campaignStartsAt: z.string().datetime().or(z.string().date()).optional(),
  campaignEndsAt: z.string().datetime().or(z.string().date()).nullable().optional(),
  rules: z.record(z.unknown()).nullable().optional(),
  audienceDefinition: z.record(z.unknown()).nullable().optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED']).optional(),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value?: string | null) {
  if (value == null) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('DATA_INVALIDA');
  return date;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!hasRenewalPermission(user.role, 'renewal.campaign.manage')) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para editar campanhas.');
  }

  try {
    const { id } = await context.params;
    const body = updateSchema.parse(await request.json().catch(() => null));
    const campaign = await updateRenewalCampaign(
      {
        contaId: user.contaId,
        actorId: user.id,
        campaignId: id,
        ...body,
        campaignStartsAt: parseDate(body.campaignStartsAt) ?? undefined,
        campaignEndsAt: parseDate(body.campaignEndsAt),
      },
      { prisma },
    );
    return NextResponse.json({ campaign }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }
    if (error instanceof Error && error.message === 'CAMPANHA_NAO_ENCONTRADA') {
      return jsonError(404, 'CAMPANHA_NAO_ENCONTRADA', 'Campanha não encontrada.');
    }
    return jsonError(
      500,
      'ERRO_ATUALIZAR_CAMPANHA',
      error instanceof Error ? error.message : 'Erro ao atualizar campanha.',
    );
  }
}
