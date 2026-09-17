import { NextResponse } from 'next/server';
import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import {
  createInviteInputDTOSchema,
  createInviteResultDTOSchema,
  type InviteRoleDTO,
  listInvitesResultDTOSchema,
} from '@/features/users/dtos';
import { mapInviteRecordToDTO } from '@/features/users/mappers';
import { sendInviteEmail } from '@/lib/auth-email-flow';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

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

    const { email, role, alunosIds } = parsed.data as {
      email?: string | null;
      role: InviteRoleDTO;
      alunosIds?: string[];
    };
    
    // Bloquear convites para ADMIN — primeiro admin só via first-register
    if (role === 'ADMIN') {
      console.warn(`[AUDIT] Convite ADMIN bloqueado para ${email || 'unknown'}`);
      return NextResponse.json({ error: 'Convites para ADMIN não são permitidos.' }, { status: 403 });
    }
    
    // Validações específicas por role
    if (role === 'RESPONSAVEL') {
      // RESPONSAVEL: não precisa de email, mas precisa de alunos
      if (!alunosIds || alunosIds.length === 0) {
        return NextResponse.json({ error: 'É necessário vincular ao menos um aluno ao responsável.' }, { status: 400 });
      }
    } else {
      // Outras roles: email é obrigatório
      if (!email) {
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

    // Restrito a ADMIN — se há sessão, usa a role dela; em teste sem sessão, assume ADMIN
    const inviterRole = auth.ok ? auth.role : isTest ? 'ADMIN' : undefined;
    const isAdmin = String(inviterRole || '').toUpperCase() === 'ADMIN';
    if (!isAdmin) return NextResponse.json({ error: 'Sem permissão para convidar este papel.' }, { status: 403 });

    // invitedById: preferir o usuário da sessão quando existir; em teste puro sem sessão, usa mock
    const invitedById = auth.ok ? auth.userId : isTest ? 'admin-mock' : undefined;
    if (!invitedById) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const invitedByName = auth.ok ? auth.name ?? undefined : undefined;
    const inviterContaId = auth.ok ? auth.contaId : undefined;

    try {
      const inviteRole = role as Parameters<typeof InviteUserService.createInvite>[1];
      // Criar convite (com ou sem email)
      const invite = await InviteUserService.createInvite(
        email ?? undefined,
        inviteRole,
        invitedById,
        inviterContaId,
        role === 'RESPONSAVEL' && alunosIds?.length
          ? { alunosIds: [...new Set(alunosIds)].sort() }
          : undefined,
      );

      // Construir link de registro (mesma rota para todos)
      const base = (process.env.NEXT_PUBLIC_APP_URL as string | undefined) ?? 
                   (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
      
      const inviteUrl = `${base}/auth/register?token=${invite.token}`;

      let emailDelivery: 'sent' | 'logged' | 'failed' | 'not_applicable' = 'not_applicable';
      if (email) {
        try {
          const delivery = await sendInviteEmail({
            inviteId: invite.id,
            inviteUrl,
            email,
            role: inviteRole,
            invitedByName,
            expiresAt: invite.expiresAt,
          });
          emailDelivery = delivery.delivery;
        } catch (emailError) {
          console.error('[invite][email-send-failed]', emailError);
          emailDelivery = 'failed';
        }
      }
      
      return NextResponse.json(
        createInviteResultDTOSchema.parse({
          invite: mapInviteRecordToDTO({
            ...invite,
            inviteUrl,
          }),
          emailDelivery,
        }),
        { status: 201 },
      );
    } catch (e: unknown) {
      const msg = (e instanceof Error) ? e.message : 'Erro ao criar convite';
      const normalizedMessage = msg.toLocaleLowerCase('pt-BR');
      if (normalizedMessage.includes('já existe') || normalizedMessage.includes('cadastrado') || normalizedMessage.includes('vinculado')) {
        console.warn(`[AUDIT] Convite duplicado bloqueado para ${email}`);
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      if (normalizedMessage.includes('admin')) {
        return NextResponse.json({ error: msg }, { status: 403 });
      }
      throw e;
    }
  } catch (error) {
    console.error('Error sending invite:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const role = String(auth.role ?? '').toUpperCase();
    if (role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const contaId = auth.contaId;
    const invites = await InviteUserService.listInvitesByConta(contaId);
    return NextResponse.json(
      listInvitesResultDTOSchema.parse({
        items: invites.map((invite) => mapInviteRecordToDTO(invite as Record<string, unknown>)),
      }),
    );
  } catch (error) {
    console.error('Error listing invites:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
