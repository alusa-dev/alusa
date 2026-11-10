import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';

const schema = z.object({
  cicloAcademicoId: z.string().trim().min(1),
  vigenciaIniciadaEm: z.string().datetime(),
  motivo: z.string().trim().min(8).max(1000),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await resolveTenantSession(new URL(req.url).searchParams.get('contaId'));
  if (!auth.ok) return NextResponse.json({ error: { code: 'NAO_AUTORIZADO' } }, { status: 401 });
  if (auth.authContext === 'PORTAL' || auth.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'PERMISSAO_NEGADA' } }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || new Date(parsed.data.vigenciaIniciadaEm) > new Date()) {
    return NextResponse.json({ error: { code: 'DADOS_INVALIDOS' } }, { status: 422 });
  }

  return runWithTenant(auth.contaId, async (tx) => {
    const link = await tx.matriculaVinculoAcademico.findFirst({
      where: { id, contaId: auth.contaId },
      select: { id: true, modalidadeId: true, cicloAcademicoId: true, vigenciaIniciadaEm: true },
    });
    if (!link) return NextResponse.json({ error: { code: 'NAO_ENCONTRADO' } }, { status: 404 });
    if (link.cicloAcademicoId != null || link.vigenciaIniciadaEm != null) {
      return NextResponse.json({ error: { code: 'VINCULO_JA_RECONCILIADO' } }, { status: 409 });
    }
    const cycle = await tx.cicloAcademico.findFirst({
      where: { id: parsed.data.cicloAcademicoId, contaId: auth.contaId, modalidadeId: link.modalidadeId },
      select: { id: true },
    });
    if (!cycle) return NextResponse.json({ error: { code: 'CICLO_INVALIDO' } }, { status: 422 });

    const vigenciaIniciadaEm = new Date(parsed.data.vigenciaIniciadaEm);
    const result = await tx.matriculaVinculoAcademico.updateMany({
      where: {
        id: link.id,
        contaId: auth.contaId,
        cicloAcademicoId: link.cicloAcademicoId,
        vigenciaIniciadaEm: link.vigenciaIniciadaEm,
      },
      data: { cicloAcademicoId: cycle.id, vigenciaIniciadaEm },
    });
    if (result.count !== 1) return NextResponse.json({ error: { code: 'VINCULO_ALTERADO' } }, { status: 409 });
    await tx.matriculaVinculoAcademicoAudit.create({
      data: {
        contaId: auth.contaId,
        vinculoAcademicoId: link.id,
        cicloAcademicoIdAnterior: link.cicloAcademicoId,
        cicloAcademicoIdNovo: cycle.id,
        vigenciaIniciadaEmAnterior: link.vigenciaIniciadaEm,
        vigenciaIniciadaEmNova: vigenciaIniciadaEm,
        motivo: parsed.data.motivo,
        autorId: auth.userId,
      },
    });
    const updated = await tx.matriculaVinculoAcademico.findFirst({ where: { id: link.id, contaId: auth.contaId } });
    return NextResponse.json({ data: updated });
  });
}
