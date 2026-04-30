import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  contaFinancialPolicyResultDTOSchema,
  updateContaFinancialPolicyInputDTOSchema,
} from '@/features/configuracoes/politicas/financeiro/dtos';
import {
  buildFinancialPolicySummary,
  normalizeFinancialPolicyConfig,
  validateFinancialPolicyConfig,
} from '@/features/configuracoes/politicas/financeiro/policy-dependencies';
import {
  DEFAULT_FINANCIAL_POLICY,
  type FinancialPolicyRecord,
  getContaFinancialPolicyRecord,
  upsertContaFinancialPolicy,
} from '@/src/server/matriculas/rematricula-financial-policy.service';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

function mapPolicy(policy?: FinancialPolicyRecord | null) {
  const normalizedPolicy = normalizeFinancialPolicyConfig(
    {
      preset: policy?.preset ?? DEFAULT_FINANCIAL_POLICY.preset,
      debtScope: policy?.debtScope ?? DEFAULT_FINANCIAL_POLICY.debtScope,
      overrideRoles: (policy?.overrideRoles ?? DEFAULT_FINANCIAL_POLICY.overrideRoles) as Array<
        'ADMIN' | 'FINANCEIRO' | 'RECEPCAO'
      >,
    },
    { useDefaultOverrideRoles: true },
  );

  return contaFinancialPolicyResultDTOSchema.parse({
    policy: {
      preset: normalizedPolicy.preset,
      debtScope: normalizedPolicy.debtScope,
      overrideRoles: normalizedPolicy.overrideRoles,
      summary: buildFinancialPolicySummary(normalizedPolicy),
      updatedAt: policy?.updatedAt?.toISOString() ?? null,
    },
  });
}

export async function GET() {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO', message: 'Sessão inválida.' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Seu perfil não pode editar políticas.' });
    }

    const policy = await getContaFinancialPolicyRecord(user.contaId);
    return json(200, mapPolicy(policy));
  } catch (error) {
    console.error('[Config Politicas Financeiro][GET]', error);
    return json(500, { error: 'ERRO_INTERNO', message: (error as Error).message });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO', message: 'Sessão inválida.' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO', message: 'Seu perfil não pode editar políticas.' });
    }

    const parsed = updateContaFinancialPolicyInputDTOSchema.safeParse(await request.json());
    if (!parsed.success) {
      return json(422, {
        error: 'PAYLOAD_INVALIDO',
        message: 'Os dados enviados para a regra de rematrícula são inválidos.',
        details: parsed.error.flatten(),
      });
    }

    const validation = validateFinancialPolicyConfig(parsed.data);
    if (!validation.success) {
      return json(422, {
        error: 'POLITICA_FINANCEIRA_INVALIDA',
        message: 'A regra da rematrícula precisa de pelo menos um perfil autorizado.',
        details: {
          issues: validation.issues,
          normalized: validation.normalized,
        },
      });
    }

    const policy = await upsertContaFinancialPolicy(user.contaId, validation.normalized);
    return json(200, mapPolicy(policy));
  } catch (error) {
    console.error('[Config Politicas Financeiro][PUT]', error);
    return json(500, { error: 'ERRO_INTERNO', message: (error as Error).message });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
