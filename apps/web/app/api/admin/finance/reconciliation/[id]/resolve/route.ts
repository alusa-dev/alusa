import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { resolveFinanceReconciliationIssue } from '@alusa/finance';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  reason: z.string().trim().min(8),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const scope = await resolveTenantScope(req, { requireAdmin: true });
  if (!scope.ok) return scope.response;
  if (!scope.contaId || !scope.user?.id) {
    return NextResponse.json({ error: { code: 'NAO_AUTENTICADO', message: 'Usuário não autenticado.' } }, { status: 401 });
  }

  const params = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'DADOS_INVALIDOS', message: 'Informe uma justificativa válida.' } },
      { status: 400 },
    );
  }

  const issue = await resolveFinanceReconciliationIssue({
    contaId: scope.contaId,
    issueId: params.id,
    resolution: parsed.data.reason,
    actor: { type: 'ADMIN', id: scope.user.id },
  });

  return NextResponse.json({ success: true, data: issue });
}
