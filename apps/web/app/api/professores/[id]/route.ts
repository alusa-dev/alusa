import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  professorMutationResultDTOSchema,
  updateProfessorInputDTOSchema,
} from '@/features/cadastro/professores/dtos';
import { mapProfessorRecordToDTO } from '@/features/cadastro/professores/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}
const prisma = new PrismaClient();

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  const session = await getServerSession(authOptions).catch(() => null);
  const contaId =
    (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
  if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'É necessário estar autenticado.');
  const prof = await prisma.professor.findFirst({ where: { id: ctxParams.id, contaId } });
  if (!prof) return jsonError(404, 'NAO_ENCONTRADO', 'Professor não encontrado');
  return NextResponse.json(
    professorMutationResultDTOSchema.parse({
      data: mapProfessorRecordToDTO(prof as Record<string, unknown>),
    }),
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
    const ctxParams = await ctx.params;
  try {
    const json = await req.json();
    // Regra: impedir alteração de cpf e email
    if (json.cpf !== undefined || json.email !== undefined) {
      return jsonError(400, 'REGRA_NEGOCIO', 'Não é permitido alterar CPF ou e-mail do professor.');
    }

    const parsed = updateProfessorInputDTOSchema.safeParse(json);
    if (!parsed.success)
      return jsonError(422, 'ERRO_VALIDACAO', 'Falha de validação', parsed.error.flatten());
    const data = parsed.data;

    // Sanitização mínima
    if (data.nome) data.nome = data.nome.trim();
    if ('contaId' in data) {
      delete (data as Record<string, unknown>).contaId;
    }

    const session = await getServerSession(authOptions).catch(() => null);
    const contaId =
      (session as { user?: { contaId?: string } } | null)?.user?.contaId?.trim() || null;
    if (!contaId) return jsonError(401, 'NAO_AUTENTICADO', 'É necessário estar autenticado.');

    const existing = await prisma.professor.findFirst({ where: { id: ctxParams.id, contaId } });
    if (!existing) return jsonError(404, 'NAO_ENCONTRADO', 'Professor não encontrado');

    try {
      // Multi-tenant: usar updateMany para garantir atomicidade com contaId
      const result = await prisma.professor.updateMany({ 
        where: { id: ctxParams.id, contaId }, 
        data 
      });
      if (result.count === 0) {
        return jsonError(404, 'NAO_ENCONTRADO', 'Professor não encontrado');
      }
      // Buscar o registro atualizado
      const updated = await prisma.professor.findFirst({ where: { id: ctxParams.id, contaId } });
      if (!updated) return jsonError(404, 'NAO_ENCONTRADO', 'Professor não encontrado');
      return NextResponse.json(
        professorMutationResultDTOSchema.parse({
          data: mapProfessorRecordToDTO(updated as Record<string, unknown>),
        }),
      );
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === 'P2002') return jsonError(409, 'CONFLITO_UNICO', 'Conflito de campos únicos');
      if ((e as { code?: string })?.code === 'P2025')
        return jsonError(404, 'NAO_ENCONTRADO', 'Professor não encontrado');
      throw e;
    }
  } catch (e: unknown) {
    return jsonError(400, 'REQUISICAO_INVALIDA', (e as Error)?.message || 'Dados inválidos');
  }
}

export const PATCH = PUT;

export async function DELETE() {
  return jsonError(405, 'NAO_SUPORTADO', 'Use status INATIVO como soft delete');
}
