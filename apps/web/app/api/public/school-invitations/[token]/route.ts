import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authRegisterInputSchema } from '@/lib/dtos/auth-register.dto';
import { createFirstUser, EmailInUseError, findAcceptedSchoolInvitationByToken, findSchoolInvitationByToken, SchoolInvitationEmailMismatchError, SchoolInvitationInvalidError } from '@/lib/first-user-service';
import { ipFromRequest, rateLimitSubject, strictRateLimitAsync } from '@/lib/rate-limit';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import { requestEvidence } from '@/lib/privacy/evidence';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

const acceptSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  senha: authRegisterInputSchema.shape.senha,
  confirmacaoSenha: z.string().min(1),
  acceptLegal: z.literal(true),
  legalAcceptance: authRegisterInputSchema.shape.legalAcceptance,
}).refine((data) => data.senha === data.confirmacaoSenha, {
  path: ['confirmacaoSenha'],
  message: 'As senhas não coincidem.',
});

const noStore = { 'cache-control': 'no-store' };
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (token.length < 32 || token.length > 128) return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404, headers: noStore });
  const invitation = await findSchoolInvitationByToken(token);
  if (!invitation) return NextResponse.json({ error: 'Convite não encontrado.' }, { status: 404, headers: noStore });
  if (invitation.status === 'ACCEPTED') return NextResponse.json({ data: { status: 'ACCEPTED', schoolName: invitation.schoolName, email: invitation.email, next: '/auth/login?callbackUrl=%2Ffinance%2Fwizard' } }, { headers: noStore });
  if (invitation.status !== 'PENDING' || invitation.expiresAt <= new Date()) return NextResponse.json({ error: 'Este convite expirou ou foi revogado.', code: 'INVITATION_UNAVAILABLE' }, { status: 410, headers: noStore });
  return NextResponse.json({ data: { schoolName: invitation.schoolName, contactName: invitation.contactName, email: invitation.email, conditionType: invitation.conditionType, planCode: invitation.planCode, monthlyAmountCents: invitation.monthlyAmountCents, customBaseMonthlyAmountCents: invitation.customBaseMonthlyAmountCents, customIncludedStudentCount: invitation.customIncludedStudentCount, customMonthlyOverageAmountCents: invitation.customMonthlyOverageAmountCents, studentCount: invitation.studentCount, trialDays: invitation.trialDays, expiresAt: invitation.expiresAt.toISOString() } }, { headers: noStore });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const ip = ipFromRequest(request);
  const limit = await strictRateLimitAsync(`school-invitation-accept:ip:${await rateLimitSubject(ip)}`, 8, 15 * 60 * 1000);
  if (!limit.ok) return NextResponse.json({ error: limit.source === 'unavailable' ? 'Não foi possível validar a solicitação. Tente novamente.' : 'Muitas tentativas. Tente mais tarde.' }, { status: limit.source === 'unavailable' ? 503 : 429, headers: noStore });
  if (token.length < 32 || token.length > 128) return NextResponse.json({ error: 'Convite inválido.' }, { status: 404, headers: noStore });
  const invitation = await findSchoolInvitationByToken(token);
  if (invitation?.status === 'ACCEPTED') return NextResponse.json({ data: { status: 'ACCEPTED', email: invitation.email, next: '/auth/login?callbackUrl=%2Ffinance%2Fwizard' } }, { headers: noStore });
  if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt <= new Date()) {
    return NextResponse.json({ error: 'Convite expirado ou revogado.', code: 'SCHOOL_INVITATION_UNAVAILABLE' }, { status: 410, headers: noStore });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400, headers: noStore }); }
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.', details: parsed.error.flatten() }, { status: 400, headers: noStore });
  try {
    const user = await createFirstUser({
      escolaNome: invitation.schoolName,
      nome: `${parsed.data.firstName} ${parsed.data.lastName}`.trim(),
      email: invitation.email,
      financeIntegrationMode: 'WHITELABEL_BAAS',
      senha: parsed.data.senha,
      legalAcceptance: parsed.data.legalAcceptance,
      legalAcceptanceEvidence: requestEvidence(request),
      schoolInvitationToken: token,
    });
    try {
      await sendEmailVerificationForUser(user.id, { ip, userAgent: request.headers.get('user-agent') }, { callbackUrl: '/finance/wizard' });
    } catch (error) {
      logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/public/school-invitations/:token', method: 'POST', requestId: getRequestId(request), error, result: 'verification_email_delivery_failed' });
    }
    return NextResponse.json({ data: { status: 'ACCEPTED', email: user.email, next: '/auth/login?callbackUrl=%2Ffinance%2Fwizard' } }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof SchoolInvitationInvalidError) return NextResponse.json({ error: error.message, code: 'SCHOOL_INVITATION_UNAVAILABLE' }, { status: 409, headers: noStore });
    if (error instanceof SchoolInvitationEmailMismatchError) return NextResponse.json({ error: error.message, code: 'SCHOOL_INVITATION_EMAIL_MISMATCH' }, { status: 400, headers: noStore });
    if (error instanceof EmailInUseError) {
      const accepted = await findAcceptedSchoolInvitationByToken(token);
      if (accepted?.status === 'ACCEPTED') return NextResponse.json({ data: { status: 'ACCEPTED', email: accepted.email, next: '/auth/login?callbackUrl=%2Ffinance%2Fwizard' } }, { headers: noStore });
      return NextResponse.json({ error: error.message, code: 'EMAIL_IN_USE' }, { status: 409, headers: noStore });
    }
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/public/school-invitations/:token', method: 'POST', requestId: getRequestId(request), error });
    return NextResponse.json({ error: 'Não foi possível concluir o cadastro.' }, { status: 500, headers: noStore });
  }
}
