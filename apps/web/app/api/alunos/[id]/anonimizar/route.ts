import { NextResponse } from 'next/server';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { anonimizarAluno } from '@alusa/lib/alunos/aluno.service';
import {
  assertPlatformAccessForConta,
  platformBillingAccessResponse,
} from '@/src/server/platform-billing/capacity';
import { anonymizeStudentInputDTOSchema } from '@/features/system/dtos';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const rawParams = await params;
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    if (String(auth.role || '').toUpperCase() !== 'ADMIN') {
      return NextResponse.json({ error: 'Sem permissão' }, { status: 403 });
    }

    try {
      await assertPlatformAccessForConta({ contaId: auth.contaId, capability: 'ADMIN_WRITE' });
    } catch (error) {
      const blocked = platformBillingAccessResponse(error);
      if (blocked) return NextResponse.json(blocked.body, { status: blocked.status });
      throw error;
    }

    const body = anonymizeStudentInputDTOSchema.parse(await req.json().catch(() => ({})));
    const motivo = body.motivo;

    const aluno = await anonimizarAluno({
      id: rawParams.id,
      contaId: auth.contaId,
      motivo,
      actorId: auth.userId,
    });

    return NextResponse.json({ success: true, aluno });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'Erro ao anonimizar aluno' },
      { status: 400 },
    );
  }
}
