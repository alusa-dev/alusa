import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  fiscalSettingsResponseSchema,
  saveFiscalSettingsInputSchema,
} from '@/features/configuracoes/notafiscal/dtos';
import {
  getFiscalInvoiceSettings,
  saveFiscalCoreSettings,
  type SaveFiscalInvoiceSettingsFailure,
} from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

type SessionUser = { id?: string; role?: string; contaId?: string };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

function isStructuredSaveError(error: unknown): error is SaveFiscalInvoiceSettingsFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    'step' in error &&
    'message' in error
  );
}

/** Persiste emissor + informações fiscais no Asaas (passos 1–2 da doc) antes de listar serviços. */
export async function PUT(request: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(user.contaId);
    if (!gate.ok) return gate.response;

    const contentType = request.headers.get('content-type') ?? '';
    let body: Record<string, unknown> = {};
    let certificateFile: File | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      form.forEach((value, key) => {
        if (key === 'certificateFile' && value instanceof File) {
          certificateFile = value;
          return;
        }
        if (typeof value === 'string') {
          if (value === 'true') body[key] = true;
          else if (value === 'false') body[key] = false;
          else body[key] = value;
        }
      });
    } else {
      body = (await request.json().catch(() => null)) as Record<string, unknown>;
    }

    const parsed = saveFiscalSettingsInputSchema.safeParse(body);
    if (!parsed.success) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: parsed.error.flatten() });
    }

    const result = await saveFiscalCoreSettings({
      contaId: user.contaId,
      actor: { type: 'USER', id: user.id },
      ...parsed.data,
      certificateFile,
    });

    if (!result.success) {
      if (isStructuredSaveError(result.error)) {
        return json(422, {
          error: result.error.kind === 'VALIDATION' ? 'VALIDACAO_FISCAL' : 'ERRO_ASAAS_FISCAL',
          step: result.error.step,
          message: result.error.message,
          details: result.error.details,
          issues: result.error.issues ?? [],
        });
      }

      const status =
        result.error === 'FEATURE_DISABLED'
          ? 403
          : result.error === 'KYC_NAO_APROVADO'
            ? 409
            : result.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
              ? 503
              : 500;
      return json(status, { error: result.error });
    }

    const refreshed = await getFiscalInvoiceSettings({ contaId: user.contaId });
    if (!refreshed.success) return json(200, { data: { coreResult: result.data } });

    return json(200, {
      data: {
        ...fiscalSettingsResponseSchema.parse(refreshed.data),
        coreResult: result.data,
      },
    });
  } catch (error) {
    console.error('[Config NotaFiscal Nucleo][PUT]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
