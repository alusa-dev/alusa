import { NextRequest, NextResponse } from 'next/server';
import { StripeIntegrationError } from '@alusa/stripe';
import {
  PlatformBillingError,
  createPlatformBillingTrialWithoutPaymentMethod,
  createPrismaPlatformBillingStore,
  resolveSchoolCommercialTarget,
} from '@alusa/platform-billing';
import { z } from 'zod';
import { platformBillingIdempotencyKeyDTOSchema } from '@/features/platform-billing/dtos';
import { withTenantSession } from '@/lib/api/with-tenant-session';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import { ipFromRequest, rateLimitAsync } from '@/lib/rate-limit';
import {
  assertCanManagePlatformBilling,
  countActivePlatformBillingStudents,
  resolvePlatformBillingActor,
} from '@/src/server/platform-billing/platform-billing-server';

const trialSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

export async function POST(req: NextRequest) {
  const requestIp = ipFromRequest(req);
  const body = await readBody(req);

  if (!body.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });
  }

  const parsed = trialSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: 'PAYLOAD_INVALIDO' }, { status: 400 });
  }

  const rawIdempotencyKey = req.headers.get('idempotency-key')?.trim() || parsed.data.idempotencyKey;
  if (!rawIdempotencyKey) {
    return NextResponse.json(
      {
        error: 'PLATFORM_BILLING_IDEMPOTENCY_REQUIRED',
        message: 'A chave de idempotência é obrigatória.',
      },
      { status: 400 },
    );
  }
  const parsedIdempotencyKey = platformBillingIdempotencyKeyDTOSchema.safeParse(rawIdempotencyKey);
  if (!parsedIdempotencyKey.success) {
    return NextResponse.json({ error: 'PLATFORM_BILLING_INPUT_INVALID' }, { status: 400 });
  }
  const idempotencyKey = parsedIdempotencyKey.data;

  return withTenantSession(async ({ contaId, userId, tx }) => {
    const rate = await rateLimitAsync(
      `platform-billing:trial:${contaId}:${userId}:${requestIp}`,
      20,
      10 * 60_000,
    );
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'RATE_LIMITED' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
        },
      );
    }

    const actor = await resolvePlatformBillingActor({ tx, contaId, userId });
    const forbidden = assertCanManagePlatformBilling(actor.canManagePlatformBilling);
    if (forbidden) return forbidden;

    // The SaaS trial is independent of Asaas finance onboarding/KYC. Account
    // creation already captures the school/admin setup and this route requires
    // an active tenant plus an authorized administrator.
    const conta = await tx.conta.findFirst({
      where: { id: contaId, status: 'ATIVO', deletedAt: null },
      select: { id: true },
    });
    if (!conta) {
      return NextResponse.json({
        error: 'INITIAL_SETUP_REQUIRED',
        message: 'A conta precisa estar ativa antes de iniciar o período de teste.',
      }, { status: 409 });
    }

    const [activeStudents, onboardingPricing] = await Promise.all([
      countActivePlatformBillingStudents({ tx, contaId }),
      tx.financeProfile.findUnique({
        where: { contaId },
        select: { wizardCompletedAt: true, onboardingStudentCount: true },
      }),
    ]);
    // On first onboarding, the validated and persisted declaration sets the
    // initial trial band. Later self-service flows use live billable enrollments.
    const pricingStudentCount = activeStudents > 0
      ? activeStudents
      : onboardingPricing?.wizardCompletedAt && onboardingPricing.onboardingStudentCount !== null
        ? onboardingPricing.onboardingStudentCount
        : activeStudents;
    const commercialTarget = resolveSchoolCommercialTarget(pricingStudentCount);
    if (!commercialTarget || commercialTarget.kind === 'SPECIALIST') {
      return NextResponse.json({
        error: 'SPECIALIST_REQUIRED',
        message: 'Escolas com mais de 500 alunos precisam conversar com um especialista.',
        activeStudents: pricingStudentCount,
      }, { status: 422 });
    }

    let result: Awaited<ReturnType<typeof createPlatformBillingTrialWithoutPaymentMethod>>;
    try {
      result = await createPlatformBillingTrialWithoutPaymentMethod(
        {
          contaId,
          contaName: actor.conta?.nome ?? 'Conta Alusa',
          billingEmail: actor.user?.email ?? undefined,
          planCode: commercialTarget.band.code,
          actorUserId: userId,
          idempotencyKey,
          correlationId: idempotencyKey,
          envSource: process.env,
        },
        { store: createPrismaPlatformBillingStore(tx) },
      );
    } catch (error) {
      return trialActionErrorResponse(error);
    }

    logApiOperationalEvent({
      severity: 'info',
      eventName: 'api.platform_billing.trial.created',
      route: '/api/platform-billing/trial',
      method: 'POST',
      requestId: getRequestId(req),
    });

    return NextResponse.json({
      billingAccountId: result.billingAccountId,
      stripeSubscriptionId: result.stripeSubscriptionId,
      trialEndsAt: result.trialEndsAt?.toISOString() ?? null,
      reused: result.reused,
    });
  });
}

function trialActionErrorResponse(error: unknown): NextResponse {
  if (error instanceof PlatformBillingError) {
    return NextResponse.json(
      {
        error: error.code,
        message:
          error.code === 'PLATFORM_PRICE_MISSING'
            ? 'Este plano ainda não está disponível para contratação.'
            : 'Não foi possível iniciar o teste.',
      },
      { status: error.code === 'PLATFORM_PRICE_MISSING' ? 503 : 400 },
    );
  }

  if (error instanceof StripeIntegrationError) {
    return NextResponse.json(
      { error: error.code, message: 'O teste está temporariamente indisponível.' },
      { status: 503 },
    );
  }

  throw error;
}

async function readBody(
  req: NextRequest,
): Promise<{ success: true; data: unknown } | { success: false }> {
  try {
    return { success: true, data: await req.json() };
  } catch {
    return { success: false };
  }
}
