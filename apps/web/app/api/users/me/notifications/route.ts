import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { mapUser, profileSelect, resolveUserId } from '../helpers';
import {
  updateNotificationPreferencesInputDTOSchema,
  updateNotificationPreferencesResultDTOSchema,
} from '@/features/users/dtos';

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session?.user?.id);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = updateNotificationPreferencesInputDTOSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
    }

    const updated = await prisma.usuario.update({
      where: { id: userId },
      data: {
        notifyEmailProduct: parsed.data.emailProduct,
        notifyEmailSecurity: parsed.data.emailSecurity,
        notifyEmailMarketing: parsed.data.emailMarketing,
        notifyWhatsapp: parsed.data.whatsapp,
        notifySms: parsed.data.sms,
      },
      select: profileSelect,
    });

    const mapped = mapUser(updated);
    return NextResponse.json(
      updateNotificationPreferencesResultDTOSchema.parse({
        notifications: mapped.notifications,
      }),
    );
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
