import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: modalidadeId } = await ctx.params;
  const auth = await resolveTenantSession(new URL(req.url).searchParams.get('contaId'));
  if (!auth.ok) return NextResponse.json({ error: { code: 'NAO_AUTORIZADO' } }, { status: 401 });
  return runWithTenant(auth.contaId, async (tx) => {
    const modalidade = await tx.modalidade.findFirst({ where: { id: modalidadeId, contaId: auth.contaId }, select: { id: true } });
    if (!modalidade) return NextResponse.json({ error: { code: 'NAO_ENCONTRADO' } }, { status: 404 });
    const cobertura = await tx.historicoAcademicoCobertura.findFirst({ where: { contaId: auth.contaId, modalidadeId } });
    return NextResponse.json({ data: cobertura });
  });
}
