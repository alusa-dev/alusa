import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { welcomeWizardStatusDTOSchema } from '@/features/users/dtos';
import { resolveUserId } from '@/src/server/identity/user-profile-http.helpers';
import { jsonNoStore } from '@/lib/http-security';
import { getWelcomeWizardStatus, markWelcomeWizardSeen } from '@/src/server/users/user-account.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export async function GET(req: Request) {
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
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/me/welcome-wizard', method: 'GET', requestId: getRequestId(req), error });
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

    const updated = await markWelcomeWizardSeen(userId);

    return jsonNoStore(
      welcomeWizardStatusDTOSchema.parse({
        shouldShow: false,
        seenAt: updated.welcomeWizardSeenAt,
      }),
    );
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/me/welcome-wizard', method: 'PATCH', requestId: getRequestId(req), error });
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}
