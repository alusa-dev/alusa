import type { PersistedSession } from '@/features/session/types/session';

export type LoginInput = {
  email: string;
  password: string;
};

export type LoginResponse = PersistedSession;
