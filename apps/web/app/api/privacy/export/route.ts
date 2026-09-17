import { NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { privacyExportRequestInputDTOSchema } from '@/features/privacy/dtos';
import { requestEvidence } from '@/lib/privacy/evidence';
import { checkSecurityRateLimit } from '@/lib/security/rate-limit';
import { createPrivacyExportRequest } from '@/src/server/privacy/privacy-request.service';

export async function POST(req: Request) {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
  }

  const limiter = checkSecurityRateLimit(req, 'PRIVACY_EXPORT', auth.userId);
  if (!limiter.ok) {
    return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  }

  const parsed = privacyExportRequestInputDTOSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados invalidos.' }, { status: 400 });
  }

  const evidence = requestEvidence(req);
  const request = await createPrivacyExportRequest({
    contaId: auth.contaId,
    userId: auth.userId,
    subjectType: parsed.data.subjectType,
    subjectId: parsed.data.subjectId ?? auth.userId,
    requesterEmail: auth.email ?? null,
    requesterName: auth.name ?? null,
    details: parsed.data.details ?? null,
    ipHash: evidence.ipHash,
    userAgentHash: evidence.userAgentHash,
  });

  return NextResponse.json({ requestId: request.id, status: request.status }, { status: 202 });
}
