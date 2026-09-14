import type { PersistedSession } from '@/features/session/types/session';

export type LoginInput = {
  email: string;
  password: string;
  contaId?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
};

export type LoginResponse = PersistedSession;

export type PasswordResetRequest = {
  email: string;
};

export type ProfileUpdateInput = {
  name: string;
};

export type ProfileUpdateResponse = {
  user: Pick<PersistedSession['user'], 'name' | 'foto'>;
};
