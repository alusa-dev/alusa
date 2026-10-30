import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireSupportApi, recordSupportAccess } from '@/features/support/api/support-api.server';
import { invitationCreateSchema } from '@/features/school-invitations/schemas';
import { createCommercialSchoolInvitation, findReusableSchoolInvitation, listCommercialSchoolInvitations } from '@/features/school-invitations/service';
import { InvitationStripePriceError } from '@/features/school-invitations/custom-price';

const noStore = { 'cache-control': 'no-store' };

export async function GET(req: Request) {
  const auth = await requireSupportApi(req, { roles: ['SUPPORT_ADMIN', 'SUPPORT_FINANCE'], scope: 'admin-school-invitations' });
  if (!auth.ok) return auth.response;
  const rows = await listCommercialSchoolInvitations();
  return NextResponse.json({ success: true, data: rows }, { headers: noStore });
}

export async function POST(req: Request) {
  const auth = await requireSupportApi(req, { roles: ['SUPPORT_ADMIN', 'SUPPORT_FINANCE'], scope: 'admin-school-invitations' });
  if (!auth.ok) return auth.response;
  const requestIdempotencyKey = req.headers.get('idempotency-key')?.trim();
  if (!requestIdempotencyKey || requestIdempotencyKey.length > 128) return NextResponse.json({ success: false, error: 'Chave de idempotência obrigatória.' }, { status: 400, headers: noStore });
  const reusable = await findReusableSchoolInvitation(requestIdempotencyKey);
  if (reusable) return NextResponse.json({ success: true, data: reusable }, { headers: noStore });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Dados inválidos.' }, { status: 400, headers: noStore }); }
  const parsed = invitationCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400, headers: noStore });
  const token = randomBytes(32).toString('base64url');
  const { expirationHours, ...data } = parsed.data;
  const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  let result;
  try {
    result = await createCommercialSchoolInvitation({
      data, requestIdempotencyKey, token, expiresAt,
      createdByAdminId: auth.session.supportUserId, baseUrl,
    });
  } catch (error) {
    const known = error instanceof InvitationStripePriceError;
    return NextResponse.json({ success: false, error: known ? error.message : 'Não foi possível criar o convite.', code: known ? error.code : 'INVITATION_CREATE_FAILED' }, { status: known && error.code === 'PLATFORM_PRICE_INVALID' ? 422 : known ? 503 : 500, headers: noStore });
  }
  if (result.kind === 'invalid') return NextResponse.json({ success: false, error: result.message }, { status: 400, headers: noStore });
  if (result.kind === 'created') {
    await recordSupportAccess(req, { session: auth.session, action: 'admin.school_invitation.created', entityType: 'PLATFORM_SCHOOL_INVITATION', entityId: result.data.id, metadata: { source: 'commercial_invitation' } });
  }
  return NextResponse.json({ success: true, data: result.data }, { status: result.kind === 'created' ? 201 : 200, headers: noStore });
}
