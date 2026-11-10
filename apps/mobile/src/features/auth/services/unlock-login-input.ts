import type { LoginInput } from '../types/auth';
import type { SavedAccessProfile } from '@/features/session/types/session';

export function createUnlockLoginInput(profile: SavedAccessProfile, password: string): LoginInput {
  return {
    email: profile.user.email,
    password,
    authContext: profile.authContext,
    contaId: profile.activeContaId,
  };
}
