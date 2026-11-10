import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';
import { AcademicTransferError, registerPendingAcademicTransfer } from '@/src/server/enrollments/academic-transfer.service';
import { isTransferRelationUniqueConflict } from '@/src/server/enrollments/transfer-conflicts';

export const dynamic = 'force-dynamic';

const schema = z.object({
  origemVinculoId: z.string().trim().min(1),
  motivo: z.string().trim().min(8).max(1000),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: { code: 'NAO_AUTORIZADO' } }, { status: 401 });
  if (auth.role !== 'ADMIN' || auth.authContext === 'PORTAL') {
    return NextResponse.json({ error: { code: 'SEM_PERMISSAO' } }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: 'DADOS_INVALIDOS' } }, { status: 422 });
  const { id } = await ctx.params;

  try {
    const relation = await runWithTenant(auth.contaId, (tx) => registerPendingAcademicTransfer({
      tx,
      contaId: auth.contaId,
      sourceLinkId: parsed.data.origemVinculoId,
      destinationLinkId: id,
      reason: parsed.data.motivo,
      actorId: auth.userId,
    }));
    return NextResponse.json({ data: relation }, { status: 201 });
  } catch (error) {
    if (error instanceof AcademicTransferError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.statusCode });
    }
    if (isTransferRelationUniqueConflict(error)) {
      return NextResponse.json({ error: { code: 'TRANSFERENCIA_JA_REGISTRADA' } }, { status: 409 });
    }
    throw error;
  }
}
