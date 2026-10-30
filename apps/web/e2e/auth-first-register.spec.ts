import { expect, test } from '@playwright/test';

test('the first-register API accepts public requests into normal input validation', async ({ request }) => {
  const response = await request.post('/api/users/first-register', {
    data: { email: 'pilot-test@example.com' },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ error: 'Dados inválidos.' });
});
