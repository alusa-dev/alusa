import { NextResponse } from 'next/server';
import {
  checkFirstUserRegistrationAvailability,
  createFirstUser,
  CpfCnpjInUseError,
  EmailInUseError,
  InactiveAccountEmailError,
  PasswordPolicyError,
} from '@/lib/first-user-service';
import { ipFromRequest, rateLimitSubject, strictRateLimitAsync } from '@/lib/rate-limit';
import { firstRegisterInputDTOSchema, firstRegisterResultDTOSchema } from '@/features/users/dtos';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import { isExternalAsaasOnboardingRolloutEnabled } from '@/lib/feature-flags/external-asaas-onboarding';
import { requestEvidence } from '@/lib/privacy/evidence';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

const noStore = { 'cache-control': 'no-store' };

export async function POST(request: Request) {
  const ip = ipFromRequest(request);
  const rateLimit = await strictRateLimitAsync(
    `first-register:ip:${await rateLimitSubject(ip)}`,
    8,
    15 * 60 * 1000,
  );
  if (!rateLimit.ok) {
    const unavailable = rateLimit.source === 'unavailable';
    return NextResponse.json(
      { error: unavailable ? 'Não foi possível validar a solicitação. Tente novamente.' : 'Muitas tentativas. Tente novamente mais tarde.' },
      { status: unavailable ? 503 : 429, headers: noStore },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400, headers: noStore });
  }

  const parsed = firstRegisterInputDTOSchema.safeParse(body);
  if (!parsed.success) {
    logApiOperationalEvent({
      severity: 'warn',
      eventName: 'api.users.request.rejected',
      route: '/api/users/first-register',
      method: 'POST',
      requestId: getRequestId(request),
    });
    return NextResponse.json({ error: 'Dados inválidos.', details: parsed.error.flatten() }, { status: 400, headers: noStore });
  }

  const financeIntegrationMode = parsed.data.financeIntegrationMode ?? 'WHITELABEL_BAAS';
  if (financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT' && !isExternalAsaasOnboardingRolloutEnabled()) {
    return NextResponse.json(
      { error: 'Este fluxo ainda não está disponível para novos cadastros.', code: 'EXTERNAL_ASAAS_ONBOARDING_DISABLED' },
      { status: 403, headers: noStore },
    );
  }

  try {
    const availability = await checkFirstUserRegistrationAvailability({ email: parsed.data.email });
    if (!availability.available) {
      if (availability.reason === 'LOCAL_DEACTIVATED') {
        return NextResponse.json(
          { error: 'Já existe uma conta desativada vinculada a este e-mail. Faça login para iniciar a reativação.', code: 'ACCOUNT_DEACTIVATED' },
          { status: 409, headers: noStore },
        );
      }
      return NextResponse.json({ error: 'E-mail já está em uso.', code: 'EMAIL_IN_USE' }, { status: 409, headers: noStore });
    }

    const user = await createFirstUser({
      ...parsed.data,
      registrationSource: 'PUBLIC_SELF_SERVICE',
      legalAcceptanceEvidence: requestEvidence(request),
    });

    try {
      const studentCount = parsed.data.onboardingStudentCount;
      const callbackUrl = studentCount
        ? `/finance/wizard?studentCount=${studentCount}`
        : '/finance/wizard';
      await sendEmailVerificationForUser(user.id, { ip, userAgent: request.headers.get('user-agent') }, { callbackUrl });
    } catch (error) {
      // Account creation succeeded; record mail delivery failure for recovery.
      logApiOperationalEvent({
        severity: 'error',
        eventName: 'api.users.request.failed',
        route: '/api/users/first-register',
        method: 'POST',
        requestId: getRequestId(request),
        error,
        result: 'verification_email_delivery_failed',
      });
    }

    return NextResponse.json(
      firstRegisterResultDTOSchema.parse({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          contaId: user.contaId,
          emailVerified: Boolean(user.emailVerifiedAt),
        },
      }),
      { status: 201, headers: noStore },
    );
  } catch (error) {
    if (error instanceof InactiveAccountEmailError) {
      return NextResponse.json(
        { error: 'Já existe uma conta desativada vinculada a este e-mail. Faça login para iniciar a reativação.', code: 'ACCOUNT_DEACTIVATED' },
        { status: 409, headers: noStore },
      );
    }
    if (error instanceof EmailInUseError || error instanceof CpfCnpjInUseError) {
      return NextResponse.json({ error: error.message, code: 'EMAIL_OR_DOCUMENT_IN_USE' }, { status: 409, headers: noStore });
    }
    if (error instanceof PasswordPolicyError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: noStore });
    }
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002') {
      return NextResponse.json({ error: 'E-mail ou CPF/CNPJ já utilizado.', code: 'EMAIL_OR_DOCUMENT_IN_USE' }, { status: 409, headers: noStore });
    }

    logApiOperationalEvent({
      severity: 'error',
      eventName: 'api.users.request.failed',
      route: '/api/users/first-register',
      method: 'POST',
      requestId: getRequestId(request),
      error,
    });
    return NextResponse.json({ error: 'Não foi possível concluir o cadastro.' }, { status: 500, headers: noStore });
  }
}
