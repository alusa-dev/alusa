import { NextResponse } from 'next/server';
import {
  testCreateInviteInputDTOSchema,
  testCreateInviteResultDTOSchema,
} from '@/features/system/dtos';
import { mapTestCreateInviteResultToDTO } from '@/features/system/mappers';
import { isTestRouteEnabled } from '@/lib/security/runtime-guards';
import { createTestInvite } from '@/src/server/system/test-fixtures.service';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export async function POST(req: Request) {
  try {
    if (!isTestRouteEnabled()) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    const parsed = testCreateInviteInputDTOSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

    const invite = await createTestInvite(parsed.data);
    return NextResponse.json(
      testCreateInviteResultDTOSchema.parse(
        mapTestCreateInviteResultToDTO({
          token: invite.token,
          email: invite.email,
          role: invite.role,
        }),
      ),
    );
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.test_invite.request.failed', route: '/api/test/create-invite', method: 'POST', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
