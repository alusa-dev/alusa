import { NextResponse } from 'next/server';
import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import {
  createInviteInputDTOSchema,
  createInviteResultDTOSchema,
  listInvitesResultDTOSchema,
} from '@/features/users/dtos';
import { mapCreatedInviteRecordToDTO, mapInviteRecordToDTO } from '@/features/users/mappers';
import { sendInviteEmail } from '@/lib/auth-email-flow';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { getInviteBaseUrl } from '@/lib/app-url';
import {
  findInviteTargetInConta,
  findLegacyResponsibleTargetFromStudents,
} from '@/src/server/users/invite-scope.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export async function POST(req: Request) {
  try {
    // Rate limit: 30 reqs / 15min por IP
    const ip = ipFromRequest(req);
    const rl = rateLimit(`invite:create:${ip}`, 30, 15 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
    const body: unknown = await req.json();
    const parsed = createInviteInputDTOSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', details: parsed.error.errors },
        { status: 400 }
      );
    }

    const legacyInput = 'target' in parsed.data ? null : parsed.data;
    const targetInput = 'target' in parsed.data
      ? parsed.data.target
      : legacyInput?.email
        ? { kind: 'EMAIL' as const, email: legacyInput.email, role: legacyInput.role }
        : null;
    const role = targetInput?.role ?? legacyInput?.role;
    
    // Convites de ADMIN permanecem bloqueados; o cadastro público está fechado durante o piloto.
    if (role === 'ADMIN') {
      logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.request.rejected', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req) });
      return NextResponse.json({ error: 'Convites para ADMIN não são permitidos.' }, { status: 403 });
    }
    
    // Validações específicas por role
    if (!role) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
    if (targetInput?.kind === 'EMAIL' && role === 'RESPONSAVEL') {
      return NextResponse.json({ error: 'Responsável deve ser selecionado a partir de um cadastro da escola.' }, { status: 400 });
    }
    if (legacyInput && role === 'RESPONSAVEL' && (!legacyInput.alunosIds || legacyInput.alunosIds.length === 0)) {
      return NextResponse.json({ error: 'É necessário selecionar um cadastro de responsável existente.' }, { status: 400 });
    }
    if (targetInput?.kind === 'EXISTING_RECORD' &&
      ((role === 'RESPONSAVEL') !== (targetInput.recordType === 'RESPONSAVEL'))) {
      return NextResponse.json({ error: 'Tipo de cadastro incompatível com o papel solicitado.' }, { status: 400 });
    }
    if (role !== 'RESPONSAVEL' && targetInput?.kind !== 'EXISTING_RECORD' && !targetInput?.email) {
      if (!legacyInput?.email) {
        return NextResponse.json({ error: 'Email é obrigatório para esta função.' }, { status: 400 });
      }
    }

    const isTest =
      process.env.NODE_ENV === 'test' ||
      (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true');
    const auth = await resolveTenantSession();
    if (!auth.ok && !isTest) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ADMIN pode convidar colaboradores e responsáveis; RECEPCAO pode apenas
    // iniciar convites de responsáveis, dentro da escola ativa.
    const inviterRole = auth.ok ? auth.role : isTest ? 'ADMIN' : undefined;
    const normalizedInviterRole = String(inviterRole || '').toUpperCase();
    const canInviteRole = normalizedInviterRole === 'ADMIN' ||
      (normalizedInviterRole === 'RECEPCAO' && role === 'RESPONSAVEL');
    if (!canInviteRole) return NextResponse.json({ error: 'Sem permissão para convidar este papel.' }, { status: 403 });

    // invitedById: preferir o usuário da sessão quando existir; em teste puro sem sessão, usa mock
    const invitedById = auth.ok ? auth.userId : isTest ? 'admin-mock' : undefined;
    if (!invitedById) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const invitedByName = auth.ok ? auth.name ?? undefined : undefined;
    const inviterContaId = auth.ok ? auth.contaId : undefined;

    let inviteBaseUrl: string;
    try {
      inviteBaseUrl = getInviteBaseUrl();
    } catch (error) {
      logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req), error });
      return NextResponse.json(
        { error: 'Não foi possível gerar o convite agora. Tente novamente mais tarde.' },
        { status: 503 },
      );
    }

    try {
      if (!inviterContaId) return NextResponse.json({ error: 'Conta inválida.' }, { status: 403 });
      const inviteRole = role as Parameters<typeof InviteUserService.createInvite>[1];
      let resolvedTarget: Awaited<ReturnType<typeof findInviteTargetInConta>> | null = null;
      if (targetInput?.kind === 'EXISTING_RECORD') {
        resolvedTarget = await findInviteTargetInConta(inviterContaId, targetInput);
      } else if (legacyInput && role === 'RESPONSAVEL' && legacyInput.alunosIds) {
        resolvedTarget = await findLegacyResponsibleTargetFromStudents(inviterContaId, legacyInput.alunosIds);
      }
      if ((targetInput?.kind === 'EXISTING_RECORD' || role === 'RESPONSAVEL') && !resolvedTarget) {
        return NextResponse.json({ error: 'Cadastro não localizado nesta escola ou sem vínculos válidos.' }, { status: 404 });
      }
      if (resolvedTarget?.accessStatus === 'ACTIVE') {
        return NextResponse.json({ error: 'Este cadastro já tem acesso ativo nesta escola.' }, { status: 409 });
      }
      const inviteEmail = resolvedTarget?.recordType === 'RESPONSAVEL'
        ? null
        : resolvedTarget?.email ?? (targetInput?.kind === 'EMAIL' ? targetInput.email : legacyInput?.email ?? null);
      if (!inviteEmail && role !== 'RESPONSAVEL') return NextResponse.json({ error: 'Email é obrigatório para esta função.' }, { status: 400 });
      const metadata = resolvedTarget
        ? {
            target: { kind: 'EXISTING_RECORD' as const, recordType: resolvedTarget.recordType, recordId: resolvedTarget.recordId },
            ...(resolvedTarget.recordType === 'RESPONSAVEL' ? { alunosIds: resolvedTarget.alunosIds } : {}),
          }
        : undefined;
      const invite = await InviteUserService.createInvite(
        inviteEmail,
        inviteRole,
        invitedById,
        inviterContaId,
        metadata,
      );

      // Construir link de registro (mesma rota para todos)
      const inviteUrl = new URL('/auth/register', `${inviteBaseUrl}/`);
      inviteUrl.searchParams.set('token', invite.token);
      const inviteLink = inviteUrl.toString();

      let emailDelivery: 'sent' | 'logged' | 'failed' | 'not_applicable' = 'not_applicable';
      if (inviteEmail) {
        try {
          const delivery = await sendInviteEmail({
            inviteId: invite.id,
            inviteUrl: inviteLink,
            email: inviteEmail,
            role: inviteRole,
            invitedByName,
            expiresAt: invite.expiresAt,
          });
          emailDelivery = delivery.delivery;
        } catch {
          logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.invite.delivery.failed', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req) });
          emailDelivery = 'failed';
        }
        try {
          await InviteUserService.recordInviteEmailDelivery({
            inviteId: invite.id,
            contaId: inviterContaId,
            delivery: emailDelivery === 'sent' ? 'SENT' : emailDelivery === 'logged' ? 'LOGGED' : 'FAILED',
          });
        } catch {
          // The invitation remains pending; never log provider payloads or URLs.
          logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.invite.delivery.failed', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req) });
        }
      }
      
      return NextResponse.json(
        createInviteResultDTOSchema.parse({
          invite: mapCreatedInviteRecordToDTO({
            ...invite,
            emailDeliveryStatus: emailDelivery === 'sent' ? 'SENT' : emailDelivery === 'logged' ? 'LOGGED' : emailDelivery === 'failed' ? 'FAILED' : 'NOT_APPLICABLE',
            deliveryAttempts: inviteEmail ? 1 : 0,
            lastDeliveryAttemptAt: inviteEmail ? new Date() : null,
            lastDeliveryErrorCode: emailDelivery === 'failed' ? 'DELIVERY_FAILED' : null,
            inviteUrl: inviteLink,
          }),
          emailDelivery,
        }),
        { status: 201 },
      );
    } catch (e: unknown) {
      const msg = (e instanceof Error) ? e.message : 'Erro ao criar convite';
      const normalizedMessage = msg.toLocaleLowerCase('pt-BR');
      if (e instanceof InviteUserService.MissingContaError) {
        return NextResponse.json({ error: msg }, { status: 403 });
      }
      if (e instanceof InviteUserService.StudentAlreadyLinkedError) {
        return NextResponse.json({ error: msg, code: 'STUDENT_ALREADY_LINKED' }, { status: 409 });
      }
      if (e instanceof InviteUserService.InvalidInviteTargetError) {
        return NextResponse.json({ error: msg, code: 'INVALID_TARGET' }, { status: 404 });
      }
      if (e instanceof InviteUserService.UserInactiveError) {
        return NextResponse.json({ error: msg, code: 'ACCOUNT_INACTIVE' }, { status: 409 });
      }
      if (normalizedMessage.includes('já existe') || normalizedMessage.includes('cadastrado') || normalizedMessage.includes('vinculado')) {
        logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.request.rejected', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req) });
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      if (normalizedMessage.includes('admin')) {
        return NextResponse.json({ error: msg }, { status: 403 });
      }
      throw e;
    }
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/invite', method: 'POST', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const role = String(auth.role ?? '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'RECEPCAO') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const contaId = auth.contaId;
    const invites = await InviteUserService.listInvitesByConta(contaId);
    return NextResponse.json(
      listInvitesResultDTOSchema.parse({
        items: invites
          .filter((invite) => role === 'ADMIN' || invite.role === 'RESPONSAVEL')
          .map((invite) => mapInviteRecordToDTO(invite as Record<string, unknown>)),
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/invite', method: 'GET', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
