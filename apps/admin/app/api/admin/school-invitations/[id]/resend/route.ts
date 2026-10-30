import { NextResponse } from 'next/server';
import { requireSupportApi, recordSupportAccess } from '@/features/support/api/support-api.server';
import { resendCommercialSchoolInvitation } from '@/features/school-invitations/service';
import { SchoolInvitationUseCaseError } from '@/features/school-invitations/use-cases';

const noStore = { 'cache-control': 'no-store' };

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSupportApi(req, { roles: ['SUPPORT_ADMIN', 'SUPPORT_FINANCE'], scope: 'admin-school-invitations' });
  if (!auth.ok) return auth.response;
  const requestKey = req.headers.get('idempotency-key')?.trim();
  if (!requestKey || requestKey.length > 128) return NextResponse.json({ success: false, error: 'Chave de idempotência obrigatória.' }, { status: 400, headers: noStore });
  const { id } = await context.params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  let result;
  try {
    result = await resendCommercialSchoolInvitation({ id, actorId: auth.session.supportUserId, requestKey, baseUrl });
  } catch (error) {
    if (error instanceof SchoolInvitationUseCaseError && error.code === 'RESEND_TOKEN_SECRET_UNAVAILABLE') {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: 503, headers: noStore });
    }
    throw error;
  }

  if (result.kind === 'not_found') return NextResponse.json({ success: false, error: 'Convite não encontrado.' }, { status: 404, headers: noStore });
  if (result.kind === 'conflict') return NextResponse.json({ success: false, error: 'Somente convites pendentes podem ser reenviados.' }, { status: 409, headers: noStore });
  if (result.kind === 'rate_limited') return NextResponse.json({ success: false, error: 'Aguarde um minuto antes de reenviar o convite.' }, { status: 429, headers: noStore });
  if (result.kind === 'resent' || result.kind === 'stale') {
    await recordSupportAccess(req, { session: auth.session, action: 'admin.school_invitation.resent', entityType: 'PLATFORM_SCHOOL_INVITATION', entityId: id, metadata: { source: 'commercial_invitation', emailDeliveryStatus: result.data.emailDeliveryStatus, stale: result.kind === 'stale' } });
  }
  return NextResponse.json({ success: true, data: result.data }, { headers: noStore });
}
