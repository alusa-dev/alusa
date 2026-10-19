import { expect, test } from '@playwright/test';

test('the first-register API rejects unaffiliated public signup with a stable response', async ({ request }) => {
  const response = await request.post('/api/users/first-register', {
    data: { email: 'pilot-test@example.com' },
  });

  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ code: 'PUBLIC_SIGNUP_CLOSED' });
});
