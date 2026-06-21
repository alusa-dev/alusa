import { z } from 'zod';

import { secureStorage, type SecureStorage } from '@/lib/storage/secure-storage';
import type { PersistedSession } from '../types/session';

const SESSION_STORAGE_KEY = 'alusa.mobile.session.v1';

const sessionSchema = z.object({
  version: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  activeContaId: z.string().nullable().optional(),
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    name: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    contaId: z.string().nullable().optional(),
    emailVerified: z.boolean().optional(),
    accountActive: z.boolean().optional(),
    contas: z
      .array(z.object({ id: z.string(), nome: z.string().nullable().optional(), role: z.string().nullable().optional() }))
      .optional(),
  }),
});

export async function readPersistedSession(storage: SecureStorage = secureStorage) {
  const raw = await storage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      await storage.deleteItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed.data satisfies PersistedSession;
  } catch {
    await storage.deleteItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export async function writePersistedSession(
  session: PersistedSession,
  storage: SecureStorage = secureStorage,
) {
  await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function clearPersistedSession(storage: SecureStorage = secureStorage) {
  await storage.deleteItem(SESSION_STORAGE_KEY);
}
