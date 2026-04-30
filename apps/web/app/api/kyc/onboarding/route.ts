import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { ZodError } from 'zod';
import { AsaasHttpError } from '@alusa/asaas';

import { authOptions } from '@/lib/auth-options';
import {
  AsaasSandboxSubaccountDailyLimitError,
  MissingAsaasAccountIdError,
  MissingAsaasApiKeyError,
  MissingBirthDateError,
  MissingCompanyTypeError,
  submitKycData,
} from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

type AsaasErrorItem = { code?: string; description?: string };

function extractAsaasErrors(response: unknown): AsaasErrorItem[] {
  if (!response || typeof response !== 'object') return [];
  const errors = (response as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  const result: AsaasErrorItem[] = [];
  for (const item of errors) {
    if (!item || typeof item !== 'object') continue;
    const code = (item as { code?: unknown }).code;
    const description = (item as { description?: unknown }).description;
    result.push({
      code: typeof code === 'string' ? code : undefined,
      description: typeof description === 'string' ? description : undefined,
    });
  }
  return result;
}

function asaasErrorText(value: AsaasErrorItem): string {
  const code = value.code?.trim();
  const description = value.description?.trim();
  if (code && description) return `[${code}] ${description}`;
  return description ?? code ?? 'Erro do Asaas';
}

function isLikelyConfigurationError(item: AsaasErrorItem): boolean {
  const code = (item.code ?? '').toLowerCase();
  const desc = (item.description ?? '').toLowerCase();
  if (code.includes('invalid_object') && desc.includes('url')) return true;
  if (desc.includes('url') && (desc.includes('inválida') || desc.includes('invalida'))) return true;
  return false;
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

export async function POST(req: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const payload = (await req.json()) as unknown;

    const result = await submitKycData({
      contaId: user.contaId,
      payload: payload as never,
      actor: { type: 'USER', id: user.id },
    });

    return json(200, { data: result });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('ASAAS_WEBHOOK_AUTH_TOKEN_SECRET') ||
        error.message.includes('ASAAS_WEBHOOK_PUBLIC_BASE_URL') ||
        error.message.includes('NEXT_PUBLIC_APP_URL'))
    ) {
      return json(503, {
        code: 'ENV_NOT_CONFIGURED',
        message: 'Não foi possível continuar por um problema de configuração. Tente novamente em instantes.',
      });
    }

    if (error instanceof ZodError) {
      return json(422, { error: 'PAYLOAD_INVALIDO', details: error.flatten() });
    }

    if (error instanceof MissingBirthDateError) {
      return json(400, { code: error.code, message: error.message });
    }

    if (error instanceof MissingCompanyTypeError) {
      return json(400, { code: error.code, message: error.message });
    }

    if (error instanceof MissingAsaasAccountIdError) {
      return json(400, { code: error.code, message: error.message });
    }

    if (error instanceof MissingAsaasApiKeyError) {
      return json(503, { code: error.code, message: error.message });
    }

    if (error instanceof AsaasSandboxSubaccountDailyLimitError) {
      return json(429, { code: error.code, message: error.message });
    }

    // Não mascarar erro upstream do Asaas como 500.
    // Também mapeia validações comuns para que a UI consiga destacar campos.
    if (error instanceof AsaasHttpError) {
      const errors = extractAsaasErrors(error.response);

      const fieldErrors: Record<string, string[]> = {};
      const formErrors: string[] = [];
      let mappedStatus: number | null = null;

      for (const item of errors) {
        const code = (item.code ?? '').toLowerCase();
        const desc = (item.description ?? '').toLowerCase();
        const text = asaasErrorText(item);

        if (isLikelyConfigurationError(item)) {
          formErrors.push('Não foi possível continuar por um problema de configuração. Tente novamente em instantes.');
          mappedStatus = 400;
          continue;
        }

        const looksLikeCpfCnpj = code.includes('cpf') || code.includes('cnpj') || desc.includes('cpf') || desc.includes('cnpj');
        const looksInvalid = code.includes('invalid') || desc.includes('invál') || desc.includes('invalid');
        const looksDuplicate = desc.includes('já cadastrad') || desc.includes('ja cadastrad') || desc.includes('já existe') || desc.includes('ja existe');
        if (looksLikeCpfCnpj && looksDuplicate) {
          fieldErrors.cpfCnpj = ['Este CPF/CNPJ já está cadastrado.'];
          mappedStatus = 409;
          continue;
        }

        if (looksLikeCpfCnpj && looksInvalid) {
          fieldErrors.cpfCnpj = ['CPF/CNPJ inválido. Verifique e tente novamente.'];
          mappedStatus = 422;
          continue;
        }

        const looksLikeEmail = code.includes('email') || desc.includes('e-mail') || desc.includes('email');
        const looksInUse = desc.includes('uso') || desc.includes('em uso') || desc.includes('cadastrad') || code.includes('already');
        if (looksLikeEmail && looksInUse) {
          formErrors.push(
            'Este e-mail já está sendo usado. Atualize o e-mail da sua conta e tente novamente.',
          );
          mappedStatus = 409;
          continue;
        }

        // Outros erros: não expor mensagem técnica para usuário final.
        // Mantém apenas um fallback genérico.
        if (!formErrors.length) {
          formErrors.push('Não foi possível concluir o cadastro. Revise seus dados e tente novamente.');
        }
      }

      if (Object.keys(fieldErrors).length > 0 || formErrors.length > 0) {
        return json(mappedStatus ?? error.status ?? 502, {
          code: 'FINANCIAL_PROVIDER_VALIDATION',
          message: Object.keys(fieldErrors).length > 0 ? 'Verifique os campos destacados e tente novamente.' : formErrors[0],
          details: {
            fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
            formErrors: formErrors.length > 0 ? formErrors : undefined,
          },
        });
      }

      return json(typeof error.status === 'number' ? error.status : 502, {
        code: 'FINANCIAL_PROVIDER_ERROR',
        message: error.message || 'Erro no provedor financeiro',
      });
    }

    console.error('[Finance Onboarding][POST]', error);
    return json(500, { error: 'ERRO_INTERNO', message: error instanceof Error ? error.message : undefined });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
