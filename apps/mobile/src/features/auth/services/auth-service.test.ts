import { authService } from './auth-service';

describe('authService', () => {
  it('não apresenta autenticação simulada quando contrato mobile não está habilitado', async () => {
    await expect(
      authService.login({ email: 'admin@alusa.test', password: 'secret' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
