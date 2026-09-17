import { NextResponse } from 'next/server';
import {
  devSetPasswordInputDTOSchema,
  devSetPasswordResultDTOSchema,
} from '@/features/system/dtos';
import { mapDevSetPasswordResultToDTO } from '@/features/system/mappers';
import { isTestRouteEnabled, notFoundJson } from '@/lib/security/runtime-guards';
import { setDevUserPassword } from '@/src/server/system/test-fixtures.service';

export async function POST(req: Request) {
  if (!isTestRouteEnabled()) {
    return notFoundJson();
  }
  const body = await req.json();
  const parsed = devSetPasswordInputDTOSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { email, password } = parsed.data;
  const user = await setDevUserPassword({ email, password });
  if (!user) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  return NextResponse.json(
    devSetPasswordResultDTOSchema.parse(
      mapDevSetPasswordResultToDTO({ ok: true, id: user.id }),
    ),
  );
}
