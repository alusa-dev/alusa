import type { PersistedSession } from '@/features/session/types/session';

export type LoginInput = {
  email: string;
  password: string;
  authContext?: 'OWNER' | 'COLLABORATOR' | 'PORTAL';
  contaId?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
};

export type LoginResponse = PersistedSession;

export type PasswordResetRequest = {
  email: string;
  authContext?: 'OWNER' | 'COLLABORATOR' | 'PORTAL';
};

export type ProfileUpdateInput = {
  name: string;
};

export type ProfileUpdateResponse = {
  user: Pick<PersistedSession['user'], 'name' | 'foto'>;
};
