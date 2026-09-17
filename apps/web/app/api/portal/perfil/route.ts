import { NextRequest } from 'next/server';
import { requirePortalUser } from '@/features/portal/api-helpers';
import { portalPerfilDTOSchema, portalPerfilInputDTOSchema } from '@/features/portal/dtos';
import { mapPortalPerfilToDTO } from '@/features/portal/mappers';
import { jsonNoStore } from '@/lib/http-security';
import { getPortalProfile, updatePortalProfile } from '@/src/server/portal/portal-profile.service';

function mapProfile(profile: { tipo: 'ALUNO' | 'RESPONSAVEL'; data: Record<string, unknown> }) {
  return portalPerfilDTOSchema.parse(
    mapPortalPerfilToDTO({ tipo: profile.tipo, ...profile.data }),
  );
}

export async function GET() {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;

    const result = await getPortalProfile({
      userId: auth.user.id,
      contaId: auth.user.contaId,
      role: auth.user.role,
    });
    if (!result) {
      return jsonNoStore(
        { error: auth.user.role === 'ALUNO' ? 'Aluno não encontrado' : 'Responsável não encontrado' },
        { status: 404 },
      );
    }
    if (!result.ok) return jsonNoStore({ error: 'Tipo de usuário inválido' }, { status: 400 });
    return jsonNoStore(mapProfile(result));
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    return jsonNoStore({ error: 'Erro ao carregar perfil' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;

    const validation = portalPerfilInputDTOSchema.safeParse(await req.json());
    if (!validation.success) {
      return jsonNoStore(
        { error: 'Dados inválidos', details: validation.error.errors },
        { status: 400 },
      );
    }

    const result = await updatePortalProfile({
      userId: auth.user.id,
      contaId: auth.user.contaId,
      role: auth.user.role,
      data: validation.data,
    });
    if (!result.ok) {
      if (result.reason === 'INVALID_ROLE') {
        return jsonNoStore({ error: 'Tipo de usuário inválido' }, { status: 400 });
      }
      return jsonNoStore(
        { error: result.tipo === 'ALUNO' ? 'Aluno não encontrado' : 'Responsável não encontrado' },
        { status: 404 },
      );
    }
    return jsonNoStore(mapProfile(result));
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    return jsonNoStore({ error: 'Erro ao atualizar perfil' }, { status: 500 });
  }
}
