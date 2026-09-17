import { NextResponse } from 'next/server';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';
import {
  fiscalSettingsResponseSchema,
  saveFiscalSettingsInputSchema,
} from '@/features/configuracoes/notafiscal/dtos';
import {
  getFiscalInvoiceSettings,
  saveFiscalInvoiceSettings,
  type SaveFiscalInvoiceSettingsFailure,
} from '@alusa/finance';

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(auth.contaId);
    if (!gate.ok) return gate.response;

    const result = await getFiscalInvoiceSettings({ contaId: auth.contaId });
    if (!result.success) return json(500, { error: result.error });

    const dto = fiscalSettingsResponseSchema.parse(result.data);
    return json(200, { data: dto });
  } catch (error) {
    console.error('[Config NotaFiscal][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
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

export async function PUT(request: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const gate = await guardFinancialAccountOr412(auth.contaId);
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

    const result = await saveFiscalInvoiceSettings({
      contaId: auth.contaId,
      actor: { type: 'USER', id: auth.userId },
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

    const refreshed = await getFiscalInvoiceSettings({ contaId: auth.contaId });
    if (!refreshed.success) return json(200, { data: { readiness: result.data } });

    return json(200, {
      data: {
        ...fiscalSettingsResponseSchema.parse(refreshed.data),
        saveResult: result.data,
      },
    });
  } catch (error) {
    console.error('[Config NotaFiscal][PUT]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
