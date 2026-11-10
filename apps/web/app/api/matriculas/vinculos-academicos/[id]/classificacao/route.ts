import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';

const bodySchema = z.object({
  classificacao: z.enum(['PRIMEIRO_INGRESSO', 'REMATRICULA', 'RETORNO', 'TRANSFERENCIA', 'HISTORICO_INDETERMINADO']),
  motivo: z.string().trim().min(8).max(1000),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: { code: 'NAO_AUTORIZADO' } }, { status: 401 });
  if (auth.role !== 'ADMIN' || auth.authContext === 'PORTAL') return NextResponse.json({ error: { code: 'SEM_PERMISSAO' } }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: 'ERRO_VALIDACAO', details: parsed.error.flatten() } }, { status: 422 });
  return runWithTenant(auth.contaId, async (tx) => {
    const current = await tx.matriculaVinculoAcademico.findFirst({ where: { id, contaId: auth.contaId } });
    if (!current) return NextResponse.json({ error: { code: 'NAO_ENCONTRADO' } }, { status: 404 });
    const transfer = await tx.transferenciaAcademicaVinculo.findFirst({
      where: { contaId: auth.contaId, destinoVinculoId: id },
      select: { id: true, status: true },
    });
    if (transfer?.status === 'PENDENTE' && parsed.data.classificacao !== 'HISTORICO_INDETERMINADO') {
      return NextResponse.json({ error: { code: 'TRANSFERENCIA_PENDENTE' } }, { status: 409 });
    }
    const formalTransfer = transfer?.status === 'FORMALIZADA';
    if (formalTransfer) {
      const isIdenticalFormalTransferRetry =
        current.classificacao === 'TRANSFERENCIA' &&
        current.classificacaoOrigem === 'TRANSFERENCIA_FORMAL' &&
        parsed.data.classificacao === 'TRANSFERENCIA' &&
        parsed.data.motivo === current.classificacaoMotivo;
      if (!isIdenticalFormalTransferRetry) {
        return NextResponse.json({ error: { code: 'TRANSFERENCIA_EXIGE_RELACAO_FORMAL' } }, { status: 409 });
      }
      return NextResponse.json({ data: current });
    }
    if (parsed.data.classificacao === 'TRANSFERENCIA' || current.classificacao === 'TRANSFERENCIA') {
      return NextResponse.json({ error: { code: 'TRANSFERENCIA_EXIGE_RELACAO_FORMAL' } }, { status: 409 });
    }
    const isIdenticalManualRetry =
      current.classificacaoOrigem === 'MANUAL_ADMIN' &&
      current.classificacao === parsed.data.classificacao &&
      current.classificacaoMotivo === parsed.data.motivo;
    if (isIdenticalManualRetry) return NextResponse.json({ data: current });

    const changed = await tx.matriculaVinculoAcademico.updateMany({
      where: { id, contaId: auth.contaId, classificacao: current.classificacao },
      data: { classificacao: parsed.data.classificacao, classificacaoOrigem: 'MANUAL_ADMIN', classificacaoMotivo: parsed.data.motivo, classificacaoDefinidaEm: new Date() },
    });
    if (changed.count !== 1) {
      return NextResponse.json({ error: { code: 'CLASSIFICACAO_CONCORRENTE' } }, { status: 409 });
    }
    await tx.matriculaClassificacaoAudit.create({ data: {
      contaId: auth.contaId,
      vinculoAcademicoId: id,
      de: current.classificacao,
      para: parsed.data.classificacao,
      motivo: parsed.data.motivo,
      autorId: auth.userId,
    } });
    const updated = await tx.matriculaVinculoAcademico.findFirst({ where: { id, contaId: auth.contaId } });
    return NextResponse.json({ data: updated });
  });
}
