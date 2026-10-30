import { NextResponse } from 'next/server';
import { requireSupportApi, recordSupportAccess } from '@/features/support/api/support-api.server';
import { invitationUpdateSchema } from '@/features/school-invitations/schemas';
import { InvitationStripePriceError } from '@/features/school-invitations/custom-price';
import { getCommercialSchoolInvitation, updateCommercialSchoolInvitation } from '@/features/school-invitations/service';

const noStore = { 'cache-control': 'no-store' };

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSupportApi(req, { roles: ['SUPPORT_ADMIN', 'SUPPORT_FINANCE'], scope: 'admin-school-invitations' });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const row = await getCommercialSchoolInvitation(id);
  if (!row) return NextResponse.json({ success: false, error: 'Convite não encontrado.' }, { status: 404, headers: noStore });
  const { tokenHash: _tokenHash, requestIdempotencyKey: _requestIdempotencyKey, emailResendRequestKey: _emailResendRequestKey, ...safeRow } = row;
  return NextResponse.json({ success: true, data: safeRow }, { headers: noStore });
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSupportApi(req, { roles: ['SUPPORT_ADMIN', 'SUPPORT_FINANCE'], scope: 'admin-school-invitations' });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Dados inválidos.' }, { status: 400, headers: noStore }); }
  const parsed = invitationUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400, headers: noStore });
  let result;
  try {
    result = await updateCommercialSchoolInvitation({ id, actorId: auth.session.supportUserId, changes: parsed.data });
  } catch (error) {
    if (error instanceof InvitationStripePriceError) return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.code === 'PLATFORM_PRICE_INVALID' ? 422 : 503, headers: noStore });
    throw error;
  }
  if (result.kind === 'not_found') return NextResponse.json({ success: false, error: 'Convite não encontrado.' }, { status: 404, headers: noStore });
  if (result.kind === 'invalid') return NextResponse.json({ success: false, error: result.message }, { status: 400, headers: noStore });
  if (result.kind === 'conflict') {
    const message = ('message' in result ? result.message : undefined) ?? (result.reason === 'NOT_PENDING' ? 'Somente convites pendentes podem ser revogados.'
      : result.reason === 'IDENTITY_AFTER_ACCEPTANCE' ? 'Após o aceite, somente a condição comercial pode ser atualizada.'
      : result.reason === 'EMAIL_IMMUTABLE' ? 'O e-mail do convite é imutável. Revogue o convite e emita outro para o endereço correto.'
      : result.reason === 'BILLING_STARTED' || result.reason === 'INVITATION_BILLING_ALREADY_STARTED' ? 'O billing já foi iniciado. Use o fluxo de alteração de plano.'
      : result.reason === 'NOT_EDITABLE' ? 'Somente convites pendentes ou aceitos sem billing iniciado podem ser alterados.'
      : result.reason === 'CHANGED_CONCURRENTLY' ? 'O convite mudou de estado antes da revogação.'
      : 'O convite foi atualizado em outra operação. Recarregue os dados e tente novamente.');
    return NextResponse.json({ success: false, error: message, ...('currentStatus' in result ? { currentStatus: result.currentStatus } : {}) }, { status: 409, headers: noStore });
  }
  const action = result.kind === 'revoked' ? 'admin.school_invitation.revoked' : 'admin.school_invitation.updated';
  await recordSupportAccess(req, { session: auth.session, action, entityType: 'PLATFORM_SCHOOL_INVITATION', entityId: id, metadata: { source: 'commercial_invitation' } });
  return NextResponse.json({ success: true, data: result.data }, { headers: noStore });
}
