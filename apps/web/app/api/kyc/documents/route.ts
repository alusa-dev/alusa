import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { getKycViewModel, getKycViewModelFresh } from '@alusa/finance';

type SessionUser = { id?: string; role?: string; contaId?: string };

const allowedRoles = new Set(['ADMIN']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

/**
 * GET /api/kyc/documents
 * 
 * Retorna grupos de documentos KYC pendentes/aprovados/rejeitados.
 * Query params:
 *   - groupId?: string — filtra apenas um grupo específico
 *   - fresh?: "1" — força refresh do cache
 */
export async function GET(req: Request) {
  try {
    const user = await resolveAuth();
    if (!user?.id || !user?.contaId) return json(401, { error: 'NAO_AUTENTICADO' });
    if (!user.role || !allowedRoles.has(user.role.toUpperCase())) return json(403, { error: 'SEM_PERMISSAO' });

    const url = new URL(req.url);
    const groupId = url.searchParams.get('groupId');
    const fresh = url.searchParams.get('fresh') === '1';

    const viewModel = fresh
      ? await getKycViewModelFresh(user.contaId)
      : await getKycViewModel(user.contaId);

    // Combina todos os documentos para formar a lista completa de grupos
    const allGroups = [
      ...viewModel.pendingExternal,
      ...viewModel.pendingInternal,
      ...viewModel.completed,
    ];

    // Filtra por groupId se fornecido
    const groups = groupId
      ? allGroups.filter((g) => g.id === groupId)
      : allGroups;

    return json(200, {
      data: {
        groups,
        gateStatus: viewModel.gateStatus,
        documentsRequired: viewModel.documentsRequired,
        canUseProduct: viewModel.canUseProduct,
        blockingReason: viewModel.blockingReason,
        message: viewModel.message,
        lastCheckedAt: viewModel.lastCheckedAt,
      },
    });
  } catch (error) {
    console.error('[Finance Documents][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
