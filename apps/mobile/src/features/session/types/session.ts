export type ContaSummary = {
  id: string;
  nome?: string | null;
  role?: string | null;
};

export type AuthContext = 'OWNER' | 'COLLABORATOR' | 'PORTAL';

/** Existing login screens start in the owner context; legacy saved accesses use this fallback. */
export const DEFAULT_AUTH_CONTEXT: AuthContext = 'OWNER';

export function resolveAuthContext(context: AuthContext | undefined, role?: string | null): AuthContext {
  if (context) return context;
  const normalizedRole = role?.trim().toUpperCase();
  if (normalizedRole === 'RESPONSAVEL' || normalizedRole === 'ALUNO') return 'PORTAL';
  return DEFAULT_AUTH_CONTEXT;
}

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
  authContext?: AuthContext;
};

export type SavedAccessProfile = {
  user: SessionUser;
  activeContaId?: string | null;
  authContext: AuthContext;
  biometricEnabled: boolean;
  favorite?: boolean;
};

export type BiometricProfile = SavedAccessProfile & { biometricEnabled: true };

export type SessionStatus = 'bootstrapping' | 'anonymous' | 'locked' | 'authenticated' | 'expired' | 'error';
