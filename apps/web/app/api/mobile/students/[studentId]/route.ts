import { NextResponse } from 'next/server';
import { z } from 'zod';

import { deleteAluno, reativarAlunoCompleto } from '@alusa/lib/alunos/aluno.service';
import { updateAlunoInputDTOSchema } from '@/features/cadastro/alunos/dtos';
import {
  assertMobileStudentAccess,
  getMobileStudentDetail,
  MobileStudentNotFoundError,
  MobileStudentUnauthorizedError,
  updateMobileStudent,
} from '@/features/students/server/mobile-students.service';
import { verifyMobileAccessToken } from '@/lib/mobile-auth-service';
import { auditSensitiveAccess } from '@/lib/privacy/sensitive-access';

export const runtime = 'nodejs';

function bearerToken(request: Request) {
  const value = request.headers.get('authorization')?.trim();
  if (!value?.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim() || null;
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function actorRoleAllowed(role: string, roles: string[]) {
  return roles.includes(role.trim().toUpperCase());
}

async function authenticate(request: Request) {
  const token = bearerToken(request);
  return token ? verifyMobileAccessToken(token) : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);

  try {
    const { studentId } = await params;
    const student = await getMobileStudentDetail({ userId: actor.userId, contaId: actor.contaId, studentId });
    return response({ student });
  } catch (error) {
    if (error instanceof MobileStudentUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileStudentNotFoundError) return response({ error: { code: 'NOT_FOUND', message: 'Aluno não encontrado.' } }, 404);
    console.error('[mobile-students][detail]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível carregar os dados do aluno.' } }, 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!actorRoleAllowed(actor.role, ['ADMIN', 'GESTOR', 'FINANCEIRO', 'RECEPCAO'])) {
    return response({ error: { code: 'FORBIDDEN', message: 'Você não tem permissão para editar alunos.' } }, 403);
  }

  try {
    const { studentId } = await params;
    const parsed = updateAlunoInputDTOSchema.safeParse({ ...(await request.json()), id: studentId });
    if (!parsed.success) return response({ error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Confira os dados informados.' } }, 422);
    await updateMobileStudent({ userId: actor.userId, contaId: actor.contaId, studentId, data: parsed.data });
    await auditSensitiveAccess({
      prisma: (await import('@/lib/prisma')).default,
      req: request,
      contaId: actor.contaId,
      actorUserId: actor.userId,
      action: 'student.mobile.update',
      entityType: 'Aluno',
      entityId: studentId,
      purpose: 'STUDENT_EDIT',
      metadata: { fields: Object.keys(parsed.data).filter((field) => field !== 'id' && field !== 'foto') },
    });
    return response({ success: true });
  } catch (error) {
    if (error instanceof MobileStudentUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileStudentNotFoundError) return response({ error: { code: 'NOT_FOUND', message: 'Aluno não encontrado.' } }, 404);
    console.error('[mobile-students][update]', { error: error instanceof Error ? error.message : String(error) });
    return response({ error: { code: 'SERVER_ERROR', message: 'Não foi possível salvar os dados do aluno.' } }, 500);
  }
}

export const mobileStudentActionSchema = z.object({
  action: z.enum(['DELETE', 'REACTIVATE']),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const actor = await authenticate(request);
  if (!actor) return response({ error: { code: 'UNAUTHORIZED', message: 'Sessão inválida.' } }, 401);
  if (!actorRoleAllowed(actor.role, ['ADMIN', 'GESTOR'])) {
    return response({ error: { code: 'FORBIDDEN', message: 'Apenas administradores e gestores podem executar esta ação.' } }, 403);
  }

  let requestedAction: 'DELETE' | 'REACTIVATE' = 'DELETE';
  try {
    const { studentId } = await params;
    const parsed = mobileStudentActionSchema.safeParse(await request.json());
    if (!parsed.success) return response({ error: { code: 'INVALID_INPUT', message: 'Ação inválida.' } }, 422);
    requestedAction = parsed.data.action;
    await assertMobileStudentAccess({ userId: actor.userId, contaId: actor.contaId });

    if (parsed.data.action === 'REACTIVATE') {
      await reativarAlunoCompleto({ id: studentId, contaId: actor.contaId, actorId: actor.userId });
      return response({ success: true });
    }

    const result = await deleteAluno(studentId, actor.contaId, parsed.data.reason, false, actor.userId);
    return response({ success: true, outcome: result ? 'ARCHIVED_OR_DELETED' : 'ARCHIVED' });
  } catch (error) {
    if (error instanceof MobileStudentUnauthorizedError) return response({ error: { code: 'FORBIDDEN', message: 'Você não tem acesso a esta conta.' } }, 403);
    if (error instanceof MobileStudentNotFoundError || (error as { code?: string })?.code === 'ALUNO_NOT_FOUND') return response({ error: { code: 'NOT_FOUND', message: 'Aluno não encontrado.' } }, 404);
    const message = error instanceof Error ? error.message : 'Não foi possível concluir a ação.';
    console.error('[mobile-students][action]', { error: message });
    return response({
      error: {
        code: 'ACTION_FAILED',
        message: requestedAction === 'REACTIVATE'
          ? 'Não foi possível reativar este aluno. Tente novamente.'
          : 'Não foi possível excluir este aluno. Resolva pendências vinculadas e tente novamente.',
      },
    }, 409);
  }
}
