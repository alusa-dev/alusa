export type ContaSummary = {
  id: string;
  nome?: string | null;
  role?: string | null;
};

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
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

export type SessionStatus = 'bootstrapping' | 'anonymous' | 'authenticated' | 'expired' | 'error';
