import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import {
  createRenewalCampaign,
  listRenewalManagement,
} from '@/src/server/matriculas/renewal-management.service';
import { hasRenewalPermission } from '@/src/server/matriculas/renewal-permissions.service';

const campaignSchema = z.object({
  nome: z.string().trim().min(2),
  descricao: z.string().trim().nullable().optional(),
  targetPeriodId: z.string().trim().min(1),
  campaignStartsAt: z.string().datetime().or(z.string().date()),
  campaignEndsAt: z.string().datetime().or(z.string().date()).nullable().optional(),
  audienceDefinition: z.record(z.unknown()).nullable().optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE']).optional(),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('DATA_INVALIDA');
  return date;
}

async function requireUser(permission: 'renewal.campaign.create' | 'renewal.portal.view') {
  const user = await getSessionUser();
  if (!user) return { error: jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.') };
  if (!hasRenewalPermission(user.role, permission)) {
    return { error: jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para campanhas de rematrícula.') };
  }
  return { user };
}

export async function GET() {
  const auth = await requireUser('renewal.portal.view');
  if ('error' in auth) return auth.error;

  const result = await listRenewalManagement({ contaId: auth.user.contaId }, { prisma });
  return NextResponse.json(
    { campaigns: result.campaigns, participants: result.participants },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const auth = await requireUser('renewal.campaign.create');
  if ('error' in auth) return auth.error;

  try {
    const body = campaignSchema.parse(await request.json().catch(() => null));
    const campaignStartsAt = parseDate(body.campaignStartsAt);
    const campaignEndsAt = body.campaignEndsAt ? parseDate(body.campaignEndsAt) : null;
    if (campaignEndsAt && campaignEndsAt < campaignStartsAt) {
      return jsonError(
        422,
        'JANELA_CAMPANHA_INVALIDA',
        'A data final da campanha não pode ser anterior à data inicial.',
      );
    }

    const campaign = await createRenewalCampaign(
      {
        contaId: auth.user.contaId,
        actorId: auth.user.id,
        nome: body.nome,
        descricao: body.descricao,
        targetPeriodId: body.targetPeriodId,
        campaignStartsAt,
        campaignEndsAt,
        audienceDefinition: body.audienceDefinition,
        status: body.status,
      },
      { prisma },
    );
    return NextResponse.json({ campaign }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }
    return jsonError(
      500,
      'ERRO_CRIAR_CAMPANHA',
      error instanceof Error ? error.message : 'Erro ao criar campanha.',
    );
  }
}
