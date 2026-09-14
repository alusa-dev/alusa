export type ContaSummary = {
  id: string;
  nome?: string | null;
  role?: string | null;
};

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  foto?: string | null;
  telefone?: string | null;
  birthDate?: string | null;
  role?: string | null;
  contaId?: string | null;
  emailVerified?: boolean;
  accountActive?: boolean;
  contas?: ContaSummary[];
};

export type PersistedSession = {
  version: 1;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  user: SessionUser;
  activeContaId?: string | null;
};

export type SavedAccessProfile = {
  user: SessionUser;
  activeContaId?: string | null;
  biometricEnabled: boolean;
  favorite?: boolean;
};

export type BiometricProfile = SavedAccessProfile & { biometricEnabled: true };

export type SessionStatus = 'bootstrapping' | 'anonymous' | 'locked' | 'authenticated' | 'expired' | 'error';
