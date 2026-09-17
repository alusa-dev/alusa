import { NextResponse } from 'next/server';
import { usersCountResultDTOSchema } from '@/features/users/dtos';
import { countUsersForTestRoute } from '@/src/server/users/user-account.service';

export async function GET() {
  if (process.env.NODE_ENV === 'production' || process.env.TEST_ROUTES_ENABLED !== 'true') {
    return NextResponse.json({ error: 'disabled' }, { status: 404 });
  }
  const count = await countUsersForTestRoute();
  return NextResponse.json(usersCountResultDTOSchema.parse({ count }));
}
