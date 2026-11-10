import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: alunoId } = await ctx.params;
  const auth = await resolveTenantSession(new URL(req.url).searchParams.get('contaId'));
  if (!auth.ok) return NextResponse.json({ error: { code: 'NAO_AUTORIZADO' } }, { status: 401 });
  if (auth.authContext === 'PORTAL') return NextResponse.json({ error: { code: 'PERMISSAO_NEGADA' } }, { status: 403 });
  return runWithTenant(auth.contaId, async (tx) => {
    const student = await tx.aluno.findFirst({ where: { id: alunoId, contaId: auth.contaId }, select: { id: true } });
    if (!student) return NextResponse.json({ error: { code: 'NAO_ENCONTRADO' } }, { status: 404 });
    const data = await tx.matriculaVinculoAcademico.findMany({
      where: { contaId: auth.contaId, vigenciaIniciadaEm: { not: null }, matricula: { contaId: auth.contaId, alunoId } },
      orderBy: { vigenciaIniciadaEm: 'desc' },
      select: {
        id: true,
        modalidade: { select: { id: true, nome: true } },
        cicloAcademico: { select: { id: true, nome: true, sequencia: true } },
        transferenciaOrigem: { select: { id: true } },
        matricula: { select: { status: true, dataInicio: true, dataFimContrato: true } },
      },
    });
    return NextResponse.json({ data });
  });
}
