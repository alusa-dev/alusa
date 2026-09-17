import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { welcomeWizardStatusDTOSchema } from '@/features/users/dtos';
import { resolveUserId } from '@/src/server/identity/user-profile-http.helpers';
import { jsonNoStore } from '@/lib/http-security';
import { getWelcomeWizardStatus, markWelcomeWizardSeen } from '@/src/server/users/user-account.service';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = await resolveUserId(session?.user?.id);

    if (!userId) {
      return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getWelcomeWizardStatus(userId);

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

    const updated = await markWelcomeWizardSeen(userId);

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
