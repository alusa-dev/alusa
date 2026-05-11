import { NextResponse } from 'next/server';
import {
  checkFirstUserRegistrationAvailability,
  createFirstUser,
  EmailInUseError,
  InactiveAccountEmailError,
  CpfCnpjInUseError,
  PasswordPolicyError,
} from '@/lib/first-user-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { firstRegisterInputDTOSchema, firstRegisterResultDTOSchema } from '@/features/users/dtos';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import { isExternalAsaasOnboardingRolloutEnabled } from '@/lib/feature-flags/external-asaas-onboarding';


const schema = firstRegisterInputDTOSchema;

export async function POST(req: Request) {
  // Rate limit: 10 reqs / 15 min por IP
  const ip = ipFromRequest(req);
  const rl = rateLimit(`first-register:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
  // Regra atualizada: cadastro via tela de registro SEM token
  // deve sempre criar uma nova Conta e um ADMIN para ela.
  // Não bloqueamos mais quando já existem usuários na base.

  const body: unknown = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error('Registration validation failed:', JSON.stringify(parsed.error.flatten(), null, 2));
    return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 });
  }

  const financeIntegrationMode = parsed.data.financeIntegrationMode ?? 'WHITELABEL_BAAS';
  const externalRolloutEnabled = isExternalAsaasOnboardingRolloutEnabled();

  if (financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT' && !externalRolloutEnabled) {
    return NextResponse.json(
      { error: 'Este fluxo ainda não está disponível para novos cadastros.', code: 'EXTERNAL_ASAAS_ONBOARDING_DISABLED' },
      { status: 403 },
    );
  }

  const availability = await checkFirstUserRegistrationAvailability(parsed.data.email);
  if (!availability.available) {
    if (availability.reason === 'LOCAL_DEACTIVATED') {
      return NextResponse.json(
        {
          error: 'Já existe uma conta desativada vinculada a este e-mail. Faça login para iniciar a reativação.',
          code: 'ACCOUNT_DEACTIVATED',
        },
        { status: 409 },
      );
    }

    if (availability.reason === 'LOCAL_ACTIVE') {
      return NextResponse.json({ error: 'E-mail já está em uso.' }, { status: 409 });
    }

    if (availability.reason === 'ASAAS_EMAIL_IN_USE') {
      return NextResponse.json(
        {
          error: 'Este e-mail já está vinculado a um cadastro financeiro existente. Use outro e-mail para criar uma nova conta.',
          code: 'ASAAS_EMAIL_IN_USE',
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error: 'Não foi possível validar o e-mail no cadastro financeiro agora. Tente novamente em instantes.',
        code: 'ASAAS_UNAVAILABLE',
      },
      { status: 503 },
    );
  }

  try {
    const user = await createFirstUser(parsed.data);
    await sendEmailVerificationForUser(user.id, {
      ip,
      userAgent: req.headers.get('user-agent'),
    }, {
      callbackUrl: '/finance/wizard',
    });
    return NextResponse.json(
      firstRegisterResultDTOSchema.parse({ id: user.id, email: user.email, role: user.role }),
      { status: 201 },
    );
  } catch (e: unknown) {
    if (e instanceof InactiveAccountEmailError) {
      return NextResponse.json(
        {
          error: 'Já existe uma conta desativada vinculada a este e-mail. Faça login para iniciar a reativação.',
          code: 'ACCOUNT_DEACTIVATED',
        },
        { status: 409 },
      );
    }

    if (e instanceof EmailInUseError || e instanceof CpfCnpjInUseError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof PasswordPolicyError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (typeof e === 'object' && e !== null && 'code' in e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2002') {
        return NextResponse.json({ error: 'E-mail ou CPF/CNPJ já utilizado.' }, { status: 409 });
      }
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
