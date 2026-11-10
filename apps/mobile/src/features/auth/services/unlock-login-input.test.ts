import { createUnlockLoginInput } from './unlock-login-input';
import type { SavedAccessProfile } from '@/features/session/types/session';

describe('createUnlockLoginInput', () => {
  it('reutiliza o contexto salvo junto ao acesso escolhido', () => {
    const profile: SavedAccessProfile = {
      user: { id: 'u1', email: 'owner@alusa.test' },
      activeContaId: 'c1',
      authContext: 'OWNER',
      biometricEnabled: false,
    };

    expect(createUnlockLoginInput(profile, 'password')).toEqual({
      email: 'owner@alusa.test',
      password: 'password',
      authContext: 'OWNER',
      contaId: 'c1',
    });
  });
});
