import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/prisma/client';
import { previewInitialEnrollmentBilling } from '@/src/server/matriculas/initial-enrollment-billing-preview.service';
import { enrollmentBillingStrategyDTOSchema } from '@/features/cadastro/matriculas/dtos';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO', 'RECEPCAO']);

const dateSchema = z.union([z.string().datetime(), z.string().date()]);

const previewSchema = z.object({
  contaId: z.string().trim().optional(),
  strategy: z
    .enum(['CREATE_SEPARATE', 'INCLUDE_EXISTING', 'UNIFY_NEXT_CYCLE'])
    .default('CREATE_SEPARATE'),
  billingStrategy: enrollmentBillingStrategyDTOSchema.optional(),
  responsavelFinanceiroId: z.string().trim().nullable().optional(),
  existingFamilyGroupId: z.string().trim().nullable().optional(),
  dataInicio: dateSchema,
  dataFimContrato: dateSchema,
  formaPagamento: z.enum(['BOLETO', 'PIX', 'CARTAO', 'CARTAO_CREDITO']),
  vencimentoDia: z.number().int().min(1).max(28),
  descontoIds: z.array(z.string().trim().min(1)).optional().default([]),
  items: z
    .array(
      z.object({
        alunoId: z.string().trim().min(1),
        matriculaId: z.string().trim().nullable().optional(),
        turmaId: z.string().trim().nullable().optional(),
        comboId: z.string().trim().nullable().optional(),
        planoId: z.string().trim().nullable().optional(),
        taxaMatricula: z.number().nonnegative().nullable().optional(),
        valorMensalidadeOverride: z.number().nonnegative().nullable().optional(),
      }),
    )
    .min(1),
});

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function parseDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00.000Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Data inválida.');
  return date;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado.');
  if (!allowedRoles.has(String(user.role).toUpperCase())) {
    return jsonError(403, 'PERMISSAO_NEGADA', 'Usuário não tem permissão para matrícula.');
  }

  try {
    const raw = await request.json().catch(() => null);
    const body = previewSchema.parse(raw);
    const contaId = body.contaId?.trim() || user.contaId;
    if (contaId !== user.contaId) {
      return jsonError(403, 'CONTA_INVALIDA', 'Conta informada não pertence ao usuário.');
    }

    const preview = await previewInitialEnrollmentBilling(
      {
        contaId,
        strategy: body.strategy,
        billingStrategy: body.billingStrategy,
        responsavelFinanceiroId: body.responsavelFinanceiroId ?? null,
        existingFamilyGroupId: body.existingFamilyGroupId ?? null,
        dataInicio: parseDate(body.dataInicio),
        dataFimContrato: parseDate(body.dataFimContrato),
        formaPagamento: body.formaPagamento,
        vencimentoDia: body.vencimentoDia,
        descontoIds: body.descontoIds,
        items: body.items,
      },
      { prisma },
    );

    return NextResponse.json(preview, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(400, 'PAYLOAD_INVALIDO', 'Payload inválido.', error.issues);
    }
    return jsonError(
      500,
      'ERRO_PREVIEW_COBRANCA_MATRICULA',
      error instanceof Error ? error.message : 'Erro ao gerar preview de cobrança.',
    );
  }
}
