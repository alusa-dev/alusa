import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@alusa/database';

import { safeGetServerSession } from '@/lib/safe-server-session';

const querySchema = z.object({
  document: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 11 || value.length === 14, 'CPF/CNPJ inválido.'),
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const session = await safeGetServerSession();
  const user = session?.user as { contaId?: string | null } | undefined;
  const contaId = user?.contaId?.trim();

  if (!contaId) {
    return json(401, { error: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' });
  }

  const parsed = querySchema.safeParse({
    document: request.nextUrl.searchParams.get('document') ?? '',
  });

  if (!parsed.success) {
    return json(422, {
      error: 'DOCUMENTO_INVALIDO',
      message: 'CPF/CNPJ inválido.',
    });
  }

  const document = parsed.data.document;
  const [aluno, responsavel] = await Promise.all([
    prisma.aluno.findFirst({
      where: { contaId, cpf: document },
      select: { id: true, nome: true },
    }),
    prisma.responsavel.findFirst({
      where: { contaId, cpf: document },
      select: { id: true, nome: true },
    }),
  ]);

  const match = responsavel
    ? { type: 'RESPONSAVEL' as const, id: responsavel.id, name: responsavel.nome }
    : aluno
      ? { type: 'ALUNO' as const, id: aluno.id, name: aluno.nome }
      : null;

  return json(200, {
    exists: Boolean(match),
    match,
  });
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
