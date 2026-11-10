import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { runWithTenant } from '@/lib/prisma-tenant';
import { AcademicTransferError, formalizePendingAcademicTransfer } from '@/src/server/enrollments/academic-transfer.service';

export const dynamic = 'force-dynamic';

export async function PATCH(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantSession();
  if (!auth.ok) return NextResponse.json({ error: { code: 'NAO_AUTORIZADO' } }, { status: 401 });
  if (auth.role !== 'ADMIN' || auth.authContext === 'PORTAL') {
    return NextResponse.json({ error: { code: 'SEM_PERMISSAO' } }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const relation = await runWithTenant(auth.contaId, (tx) => formalizePendingAcademicTransfer({
      tx,
      contaId: auth.contaId,
      destinationLinkId: id,
      actorId: auth.userId,
    }));
    return NextResponse.json({ data: relation });
  } catch (error) {
    if (error instanceof AcademicTransferError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.statusCode });
    }
    throw error;
  }
}
