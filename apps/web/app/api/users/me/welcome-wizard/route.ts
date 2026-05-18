import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { welcomeWizardStatusDTOSchema } from '@/features/users/dtos';
import { resolveUserId } from '@/app/api/users/me/helpers';
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
      select: { welcomeWizardSeenAt: true },
    });

    if (!user) {
      return jsonNoStore({ error: 'Usuario nao encontrado' }, { status: 404 });
    }

    return jsonNoStore(
      welcomeWizardStatusDTOSchema.parse({
        shouldShow: user.welcomeWizardSeenAt === null,
        seenAt: user.welcomeWizardSeenAt,
      }),
    );
  } catch (error) {
    console.error('Error fetching welcome wizard status:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH() {
  try {
    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session?.user?.id);

    if (!userId) {
      return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    }

    const updated = await prisma.usuario.update({
      where: { id: userId },
      data: { welcomeWizardSeenAt: new Date() },
      select: { welcomeWizardSeenAt: true },
    });

    return jsonNoStore(
      welcomeWizardStatusDTOSchema.parse({
        shouldShow: false,
        seenAt: updated.welcomeWizardSeenAt,
      }),
    );
  } catch (error) {
    console.error('Error updating welcome wizard status:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}