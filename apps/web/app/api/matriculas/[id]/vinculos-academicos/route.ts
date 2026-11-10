import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: matriculaId } = await ctx.params;
  const auth = await resolveTenantSession(new URL(req.url).searchParams.get('contaId'));
  if (!auth.ok) return NextResponse.json({ error: { code: 'NAO_AUTORIZADO' } }, { status: 401 });
  if (auth.authContext === 'PORTAL') return NextResponse.json({ error: { code: 'PERMISSAO_NEGADA' } }, { status: 403 });
  return runWithTenant(auth.contaId, async (tx) => {
    const matricula = await tx.matricula.findFirst({ where: { id: matriculaId, contaId: auth.contaId }, select: { id: true } });
    if (!matricula) return NextResponse.json({ error: { code: 'NAO_ENCONTRADO' } }, { status: 404 });
    const data = await tx.matriculaVinculoAcademico.findMany({
      where: { contaId: auth.contaId, matriculaId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        modalidade: { select: { id: true, nome: true } },
        cicloAcademico: { select: { id: true, nome: true, sequencia: true } },
        classificacao: true,
        classificacaoOrigem: true,
        classificacaoMotivo: true,
        classificacaoDefinidaEm: true,
        transferenciaDestino: {
          select: {
            id: true,
            status: true,
            origemVinculoId: true,
            motivo: true,
            formalizadaEm: true,
            formalizadaPor: true,
          },
        },
      },
    });
    return NextResponse.json({ data });
  });
}
