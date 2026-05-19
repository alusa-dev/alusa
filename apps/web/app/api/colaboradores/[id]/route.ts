import { NextRequest, NextResponse } from 'next/server';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '@/src/prisma';
import { z } from 'zod';
import {
  generoEnum,
  cargoEnum,
  statusColabEnum,
} from '../../../../../../packages/lib/src/schemas/colaborador';
import {
  update as updateColab,
  remove as removeColab,
} from '../../../../../../packages/lib/src/server/services/colaborador-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  // Multi-tenant: obter contaId da sessão
  const { getSessionUser } = await import('@/lib/auth/session');
  const user = await getSessionUser();
  if (!user?.contaId) {
    return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
  }
  const { contaId } = user;

  const db = prisma as unknown as { colaborador: any };
  const colab = await db.colaborador.findFirst({ where: { id: ctxParams.id, contaId } });
  if (!colab) return jsonError(404, 'NAO_ENCONTRADO', 'Colaborador não encontrado');
  return NextResponse.json({ data: colab }, { headers: { 'cache-control': 'no-store' } });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    // MULTI-TENANT: obter contaId da sessão
    const { getSessionUser } = await import('@/lib/auth/session');
    const user = await getSessionUser();
    if (!user?.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    const { contaId } = user;

    const json = await req.json();
    if (json && typeof json === 'object' && 'cpf' in json) {
      return jsonError(400, 'REGRA_NEGOCIO', 'Não é permitido alterar o CPF do colaborador.');
    }
    const fotoSchema = z
      .union([
        z.string().url(),
        z.string().regex(/^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+$/, 'Foto inválida'),
      ])
      .optional()
      .nullable();

    const updateSchema = z
      .object({
        foto: fotoSchema,
        nome: z.string().min(2).optional(),
        dataNasc: z.coerce.date().optional().nullable(),
        genero: generoEnum.optional().nullable(),
        rg: z.string().optional().nullable(),
        orgaoEmissor: z.string().optional().nullable(),
        dataEmissao: z.coerce.date().optional().nullable(),
        email: z.string().email().optional().nullable(),
        telefone1: z.string().optional().nullable(),
        enderecoCep: z.string().optional().nullable(),
        enderecoLogradouro: z.string().optional().nullable(),
        enderecoNumero: z.string().optional().nullable(),
        enderecoComplemento: z.string().optional().nullable(),
        enderecoBairro: z.string().optional().nullable(),
        enderecoCidade: z.string().optional().nullable(),
        enderecoUf: z.string().length(2).optional().nullable(),
        cargo: cargoEnum.optional(),
        status: statusColabEnum.optional(),
        dataAdmissao: z.coerce.date().optional().nullable(),
        dataDesligamento: z.coerce.date().optional().nullable(),
        observacoes: z.string().optional().nullable(),
        temAcesso: z.boolean().optional(),
        roleUsuario: z.enum(['ADMIN', 'FINANCEIRO', 'RECEPCAO', 'PROFESSOR']).optional().nullable(),
      })
      .strict();
    const parsed = updateSchema.safeParse(json);
    if (!parsed.success)
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());

    // MULTI-TENANT: usar contaId da sessão, não do registro
    try {
      const updated = await updateColab(ctxParams.id, contaId, parsed.data as any);
      return NextResponse.json({ data: updated });
    } catch (e: unknown) {
      const msg = (e as Error)?.message || 'Falha ao atualizar colaborador';
      if (msg.includes('não encontrado')) {
        return jsonError(404, 'NAO_ENCONTRADO', 'Colaborador não encontrado');
      }
      return jsonError(400, 'ATUALIZACAO_FALHOU', msg);
    }
  } catch (e: unknown) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error)?.message || 'Dados inválidos');
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    // MULTI-TENANT: obter contaId da sessão
    const { getSessionUser } = await import('@/lib/auth/session');
    const user = await getSessionUser();
    if (!user?.contaId) {
      return jsonError(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    const { contaId } = user;

    // Soft delete (inativar) para preservar auditoria - MULTI-TENANT: passar contaId
    await removeColab(ctxParams.id, contaId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || 'Falha ao excluir colaborador';
    if (msg.includes('não encontrado')) {
      return jsonError(404, 'NAO_ENCONTRADO', 'Colaborador não encontrado');
    }
    return jsonError(400, 'EXCLUSAO_FALHOU', msg);
  }
}
