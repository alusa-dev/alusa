import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { isValidKycGroupId } from '@/features/kyc/utils/group-id';
import { DocumentsNotReadyError } from '@alusa/finance/errors/documents-not-ready-error';
import { getKycSnapshotByContaId } from '@alusa/finance/use-cases/kyc/get-kyc-snapshot';
import { uploadKycDocumentByGroup } from '@alusa/finance/use-cases/kyc/upload-kyc-document-by-group';
import { updateKycDocumentFile } from '@alusa/finance/use-cases/kyc/update-kyc-document-file';
import { InvalidKycGroupIdError } from '@alusa/finance/errors/invalid-kyc-group-id-error';
import { OnboardingUrlRequiredError } from '@alusa/finance/errors/onboarding-url-required-error';
import { ProviderPortalRequiredError } from '@alusa/finance/errors/provider-portal-required-error';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_GROUP_ID_LEN = 200;

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

function isValidOpaqueId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.length > MAX_GROUP_ID_LEN) return false;
  if (/[\s/]/.test(normalized)) return false;
  return true;
}

interface RouteContext {
  params: { groupId: string } | Promise<{ groupId: string }>;
}

/**
 * POST /api/kyc/documents/[groupId]/upload
 * 
 * Faz upload de documento para um grupo específico.
 * Aceita multipart/form-data com:
 *   - documentFile: arquivo (PDF, JPG, PNG, max 10MB)
 */
export async function POST(req: Request, context: RouteContext) {
  const user = await resolveAuth();
  if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
  if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

  const { groupId } = await Promise.resolve(context.params);

  if (!isValidKycGroupId(groupId)) {
    return json(400, {
      code: 'INVALID_GROUP_ID',
      message: 'groupId inválido para upload de documento.',
      groupId: typeof groupId === 'string' ? groupId : null,
    });
  }

  try {
    const formData = await req.formData();
    const documentFile = formData.get('documentFile');
    const documentType = formData.get('type');
    const slotId = formData.get('slotId');

    if (!documentFile || !(documentFile instanceof File)) {
      return json(422, { error: 'ARQUIVO_INVALIDO' });
    }

    if (!ALLOWED_TYPES.has(documentFile.type)) {
      return json(422, { error: 'TIPO_ARQUIVO_INVALIDO' });
    }

    const lowerName = documentFile.name.toLowerCase();
    const hasAllowedExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!hasAllowedExtension) {
      return json(422, { error: 'TIPO_ARQUIVO_INVALIDO' });
    }

    if (documentFile.size > MAX_SIZE) {
      return json(422, { error: 'ARQUIVO_MUITO_GRANDE' });
    }

    // Read-before-write: verifica estado atual via snapshot canônico
    const snapshot = await getKycSnapshotByContaId(user.contaId, { fresh: true });

    if (!snapshot) {
      return json(
        409,
        { code: 'WAITING_REQUIREMENTS', message: 'Os requisitos de verificação ainda estão sendo preparados.' },
        { 'Retry-After': '15' },
      );
    }

    // Verifica se o grupo existe nas ações pendentes
    const action = snapshot.nextActions.find((nextAction) => nextAction.groupId === groupId);

    if (action?.kind === 'EXTERNAL_ONBOARDING') {
      return json(409, { 
        code: 'EXTERNAL_REQUIRED', 
        message: 'Este documento deve ser enviado pelo fluxo externo.',
        data: { actionId: groupId },
      });
    }

    if (action?.kind === 'PROVIDER_PORTAL_REQUIRED') {
      return json(409, {
        code: 'PROVIDER_PORTAL_REQUIRED',
        message: 'Esta etapa precisa ser concluída no ambiente de verificação configurado para a conta.',
        data: { actionId: groupId },
      });
    }

    if (!action) {
      return json(422, {
        code: 'INVALID_GROUP_ID',
        message: 'Grupo de documento não encontrado entre as pendências atuais.',
        groupId,
      });
    }

    const normalizedSlotId = isValidOpaqueId(slotId) ? slotId.trim() : null;
    if (slotId != null && !normalizedSlotId) {
      return json(422, {
        code: 'INVALID_SLOT_ID',
        message: 'slotId inválido para atualização de documento.',
      });
    }

    if (normalizedSlotId) {
      const slotIds = (action.slots ?? []).map((s) => s.id);
      const slotBelongsToGroup = slotIds.includes(normalizedSlotId);
      if (!slotBelongsToGroup) {
        return json(409, {
          code: 'SLOT_NOT_ALLOWED',
          message: 'Este arquivo não pertence ao grupo informado. Atualize a página e tente novamente.',
        });
      }
    }

    const bytes = new Uint8Array(await documentFile.arrayBuffer());

    if (normalizedSlotId) {
      await updateKycDocumentFile({
        contaId: user.contaId,
        fileId: normalizedSlotId,
        file: {
          bytes,
          filename: documentFile.name,
          mimeType: documentFile.type,
        },
        actor: { type: 'USER', id: user.id },
      });
    } else {
      await uploadKycDocumentByGroup({
        contaId: user.contaId,
        groupId,
        type: typeof documentType === 'string' && documentType.trim() ? documentType.trim() : undefined,
        file: {
          bytes,
          filename: documentFile.name,
          mimeType: documentFile.type,
        },
        actor: { type: 'USER', id: user.id },
      });
    }

    const refreshed = await getKycSnapshotByContaId(user.contaId, { fresh: true });

    return json(200, { 
      data: {
        success: true,
        snapshot: refreshed,
      },
    });
  } catch (error: unknown) {
    if (error instanceof DocumentsNotReadyError) {
      const retryAfterMs = error.retryAfterMs ?? 15_000;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return json(
        409,
        {
          code: 'WAITING_REQUIREMENTS',
          message: 'Os requisitos de verificação ainda estão sendo preparados.',
          retryAfterMs,
        },
        { 'Retry-After': String(retryAfterSeconds) },
      );
    }

    if (error instanceof OnboardingUrlRequiredError) {
      return json(409, {
        code: 'EXTERNAL_REQUIRED',
        message: 'Este documento deve ser enviado pelo fluxo externo.',
        data: { actionId: groupId },
      });
    }

    if (error instanceof ProviderPortalRequiredError) {
      return json(409, {
        code: error.code,
        message: error.message,
        data: { actionId: error.groupId },
      });
    }

    if (error instanceof InvalidKycGroupIdError) {
      return json(400, {
        code: error.code,
        message: error.message,
        groupId: error.groupId,
      });
    }

    const message = error instanceof Error ? error.message ?? '' : '';
    if (message.toLowerCase().includes('tipo do documento')) {
      return json(422, { error: 'TIPO_DOCUMENTO_INVALIDO', message });
    }

    console.error('[Finance Documents Upload][POST]', {
      error: error instanceof Error ? error.message : String(error),
      groupId,
      contaId: user.contaId,
    });
    return json(500, { error: 'ERRO_INTERNO', message: error instanceof Error ? error.message : undefined });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
