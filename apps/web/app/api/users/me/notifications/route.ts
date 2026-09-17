import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { resolveUserId } from '@/src/server/identity/user-profile-http.helpers';
import {
  updateNotificationPreferencesInputDTOSchema,
  updateNotificationPreferencesResultDTOSchema,
} from '@/features/users/dtos';
import { updateUserNotificationPreferences } from '@/src/server/users/user-account.service';

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

    const notifications = await updateUserNotificationPreferences({ userId, ...parsed.data });
    return NextResponse.json(
      updateNotificationPreferencesResultDTOSchema.parse({
        notifications,
      }),
    );
  } catch (error) {
    console.error('Error updating notification preferences:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
