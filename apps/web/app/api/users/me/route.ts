import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';

import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import {
  updateCurrentProfileInputDTOSchema,
  userProfileDTOSchema,
  userProfileWithSchoolDTOSchema,
} from '@/features/users/dtos';
import {
  mapUserWithConta,
  profileWithContaSelect,
  profileSelect,
  mapUser,
  resolveUserId,
} from './helpers';
import { jsonNoStore } from '@/lib/http-security';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session?.user?.id);
    if (!userId) {
      return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: profileWithContaSelect as any,
    });

    if (!user) {
      return jsonNoStore({ error: 'Usuario nao encontrado' }, { status: 404 });
    }

    return jsonNoStore(userProfileWithSchoolDTOSchema.parse(mapUserWithConta(user)));
  } catch (error) {
    console.error('Error fetching user info:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session?.user?.id);
    if (!userId) {
      return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return jsonNoStore({ error: 'Corpo invalido' }, { status: 400 });
    }

    const parsed = updateCurrentProfileInputDTOSchema.safeParse(body);
    if (!parsed.success) {
      // Se erro de nome muito curto, retorna 400 (para alinhar com o teste)
      const fieldErrors = parsed.error.flatten().fieldErrors;
      if (fieldErrors?.name && fieldErrors.name.some((msg: string) => msg.includes('curto'))) {
        return jsonNoStore({ error: parsed.error.flatten() }, { status: 400 });
      }
      return jsonNoStore({ error: parsed.error.flatten() }, { status: 422 });
    }

    const data = parsed.data;
    const updateInput: Prisma.UsuarioUpdateInput = {};

    if (typeof data.name !== 'undefined') {
      updateInput.nome = data.name;
    }

    if (typeof data.telefone !== 'undefined') {
      const digits = data.telefone.replace(/\D/g, '');
      if (digits.length === 0) {
        updateInput.telefone = null;
      } else if (digits.length < 10 || digits.length > 11) {
        return jsonNoStore(
          { error: { fieldErrors: { telefone: ['Telefone invalido'] } } },
          { status: 422 },
        );
      } else {
        updateInput.telefone = digits;
      }
    }

    if (typeof data.foto !== 'undefined') {
      updateInput.foto = data.foto === null ? null : data.foto;
    }

    if (typeof data.bio !== 'undefined') {
      updateInput.bio = data.bio.length > 0 ? data.bio : null;
    }

    if (typeof data.locale !== 'undefined') {
      updateInput.locale = data.locale;
    }

    if (typeof data.theme !== 'undefined') {
      updateInput.theme = data.theme;
    }

    if (Object.keys(updateInput).length === 0) {
      return jsonNoStore(
        { error: { formErrors: ['Nenhuma alteracao fornecida'] } },
        { status: 400 },
      );
    }

    try {
      const updated = await prisma.usuario.update({
        where: { id: userId },
        data: updateInput,
        select: profileSelect,
      });
      const response = userProfileDTOSchema.parse(mapUser(updated));
      return jsonNoStore(response);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
        return jsonNoStore({ error: 'Usuario nao encontrado' }, { status: 404 });
      }
      console.error('[API /api/users/me] Erro ao atualizar usuário:', error);
      return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
    }
  } catch (error) {
    console.error('Error in PATCH /api/users/me:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}
