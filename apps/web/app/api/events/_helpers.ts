import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { EventsError, type EventsContext } from '@alusa/lib/events/events.service';

import { safeGetServerSession } from '@/lib/safe-server-session';
import { assertPlatformAccessForConta, platformBillingAccessResponse } from '@/src/server/platform-billing/capacity';
import { logApiError, logApiResponse } from '@/lib/observability/api-logger';

export type EventsPermission =
  | 'events.view'
  | 'events.create'
  | 'events.update'
  | 'events.cancel'
  | 'events.archive'
  | 'events.deleteParticipant'
  | 'eventTickets.view'
  | 'eventTickets.manageLots'
  | 'eventTickets.createSale'
  | 'eventTickets.cancelSale'
  | 'eventTickets.markPaid'
  | 'eventMaps.view'
  | 'eventMaps.manage'
  | 'eventMaps.publish'
  | 'eventCostumes.view'
  | 'eventCostumes.manage'
  | 'eventCostumes.deliver'
  | 'eventCostumes.return'
  | 'eventFinance.view'
  | 'eventFinance.createCost'
  | 'eventFinance.createRevenue'
  | 'eventFinance.markPaid'
  | 'eventFinance.markReceived'
  | 'eventFinance.cancelEntry'
  | 'eventFinance.reconcile'
  | 'eventReports.view'
  | 'eventAudit.view';

const ALL_PERMISSIONS: EventsPermission[] = [
  'events.view',
  'events.create',
  'events.update',
  'events.cancel',
  'events.archive',
  'events.deleteParticipant',
  'eventTickets.view',
  'eventTickets.manageLots',
  'eventTickets.createSale',
  'eventTickets.cancelSale',
  'eventTickets.markPaid',
  'eventMaps.view',
  'eventMaps.manage',
  'eventMaps.publish',
  'eventCostumes.view',
  'eventCostumes.manage',
  'eventCostumes.deliver',
  'eventCostumes.return',
  'eventFinance.view',
  'eventFinance.createCost',
  'eventFinance.createRevenue',
  'eventFinance.markPaid',
  'eventFinance.markReceived',
  'eventFinance.cancelEntry',
  'eventFinance.reconcile',
  'eventReports.view',
  'eventAudit.view',
];

const ROLE_PERMISSIONS: Record<string, EventsPermission[]> = {
  ADMIN: ALL_PERMISSIONS,
  RECEPCAO: [
    'events.view',
    'events.create',
    'events.update',
    'events.cancel',
    'eventTickets.view',
    'eventTickets.manageLots',
    'eventTickets.createSale',
    'eventTickets.cancelSale',
    'eventMaps.view',
    'eventMaps.manage',
    'eventMaps.publish',
    'eventCostumes.view',
    'eventCostumes.manage',
    'eventCostumes.deliver',
    'eventCostumes.return',
    'eventFinance.view',
    'eventReports.view',
    'eventAudit.view',
  ],
  FINANCEIRO: [
    'events.view',
    'eventTickets.view',
    'eventTickets.markPaid',
    'eventMaps.view',
    'eventFinance.view',
    'eventFinance.createCost',
    'eventFinance.createRevenue',
    'eventFinance.markPaid',
    'eventFinance.markReceived',
    'eventFinance.cancelEntry',
    'eventFinance.reconcile',
    'eventReports.view',
    'eventAudit.view',
  ],
  PROFESSOR: ['events.view', 'eventCostumes.view'],
};

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function getEventsContext(permission: EventsPermission): Promise<EventsContext & { role: string }> {
  const session = await safeGetServerSession();
  const user = session?.user as { contaId?: string | null; id?: string | null; role?: string | null } | undefined;
  const contaId = user?.contaId?.trim();
  const userId = user?.id?.trim();
  const role = user?.role?.trim() || 'ANONYMOUS';

  if (!contaId || !userId) {
    throw new EventsError('NAO_AUTENTICADO', 'Usuário não autenticado.', 401);
  }

  const permissions = ROLE_PERMISSIONS[role] ?? [];
  if (!permissions.includes(permission)) {
    throw new EventsError('SEM_PERMISSAO', 'Você não tem permissão para esta ação.', 403);
  }

  const readOnlyPermissions = new Set<EventsPermission>([
    'events.view',
    'eventTickets.view',
    'eventMaps.view',
    'eventCostumes.view',
    'eventFinance.view',
    'eventReports.view',
    'eventAudit.view',
  ]);
  if (!readOnlyPermissions.has(permission)) {
    await assertPlatformAccessForConta({ contaId, capability: 'EVENT_WRITE' });
  }

  return { contaId, userId, role };
}

export function handleEventsRouteError(
  error: unknown,
  fallbackCode: string,
  context?: { route: string; requestId: string; method: string; startedAt: number; tenantId?: string },
) {
  const billing = platformBillingAccessResponse(error);
  if (billing) {
    const response = NextResponse.json(billing.body, { status: billing.status });
    if (context) logApiResponse({ ...context, status: billing.status, errorCode: 'PLATFORM_BILLING_ACCESS_RESTRICTED' });
    return response;
  }

  if (error instanceof EventsError) {
    const response = jsonError(error.status, error.code, error.message, error.details);
    if (context) logApiResponse({ ...context, status: error.status, errorCode: error.code });
    return response;
  }

  if (error instanceof ZodError) {
    const response = jsonError(422, 'ERRO_VALIDACAO', 'Dados inválidos.', error.flatten());
    if (context) logApiResponse({ ...context, status: 422, errorCode: 'ERRO_VALIDACAO' });
    return response;
  }

  if (context) {
    logApiError({ ...context, status: 500, errorCode: fallbackCode, error });
  } else {
    console.error('[api/events][error]', error);
  }
  return jsonError(500, fallbackCode, (error as Error).message || 'Erro interno.');
}

export function queryObject(request: Request) {
  const { searchParams } = new URL(request.url);
  return Object.fromEntries(searchParams.entries());
}
