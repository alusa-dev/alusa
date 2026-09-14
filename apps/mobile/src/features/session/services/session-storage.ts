import { z } from 'zod';

import { secureStorage, type SecureStorage } from '@/lib/storage/secure-storage';
import type { PersistedSession, SavedAccessProfile } from '../types/session';

const SESSION_STORAGE_KEY = 'alusa.mobile.session.v1';
const SAVED_ACCESS_PROFILE_KEY = 'alusa.mobile.saved-access-profile.v1';
const LEGACY_BIOMETRIC_SESSION_KEY = 'alusa.mobile.biometric-session.v1';

const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().nullable().optional(),
  foto: z.string().nullable().optional(),
  telefone: z.string().nullable().optional(),
  birthDate: z.string().datetime().nullable().optional(),
  role: z.string().nullable().optional(),
  contaId: z.string().nullable().optional(),
  emailVerified: z.boolean().optional(),
  accountActive: z.boolean().optional(),
  contas: z
    .array(z.object({ id: z.string(), nome: z.string().nullable().optional(), role: z.string().nullable().optional() }))
    .optional(),
});

const sessionSchema = z.object({
  version: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  activeContaId: z.string().nullable().optional(),
  user: userSchema,
});

const savedAccessProfileSchema = z.object({
  user: userSchema,
  activeContaId: z.string().nullable().optional(),
  biometricEnabled: z.boolean(),
  favorite: z.boolean().optional(),
});

const biometricStorageOptions = {
  requireAuthentication: true,
  authenticationPrompt: 'Use o Face ID para entrar na Alusa',
} as const;

export function getSavedAccessProfileKey(profile: Pick<SavedAccessProfile, 'user' | 'activeContaId'>) {
  return `${profile.user.id}:${profile.activeContaId ?? profile.user.contaId ?? 'default'}`;
}

function biometricSessionKey(profile: Pick<SavedAccessProfile, 'user' | 'activeContaId'>) {
  return `alusa.mobile.biometric-session.v1.${encodeURIComponent(getSavedAccessProfileKey(profile))}`;
}

function profileFromSession(session: PersistedSession, biometricEnabled: boolean): SavedAccessProfile {
  return {
    user: session.user,
    activeContaId: session.activeContaId,
    biometricEnabled,
  };
}

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

export async function writePersistedSession(session: PersistedSession, storage: SecureStorage = secureStorage) {
  await storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function clearPersistedSession(storage: SecureStorage = secureStorage) {
  await storage.deleteItem(SESSION_STORAGE_KEY);
}

export async function readSavedAccessProfiles(storage: SecureStorage = secureStorage) {
  const raw = await storage.getItem(SAVED_ACCESS_PROFILE_KEY);
  if (!raw) return [];

  try {
    const value: unknown = JSON.parse(raw);
    const parsed = z.array(savedAccessProfileSchema).safeParse(Array.isArray(value) ? value : [value]);
    if (!parsed.success) {
      await storage.deleteItem(SAVED_ACCESS_PROFILE_KEY);
      return [];
    }
    return parsed.data satisfies SavedAccessProfile[];
  } catch {
    await storage.deleteItem(SAVED_ACCESS_PROFILE_KEY);
    return [];
  }
}

export async function readSavedAccessProfile(storage: SecureStorage = secureStorage) {
  const profiles = await readSavedAccessProfiles(storage);
  return [...profiles].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)))[0] ?? null;
}

export async function writeSavedAccessProfile(
  session: PersistedSession,
  biometricEnabled = false,
  storage: SecureStorage = secureStorage,
) {
  const profile = profileFromSession(session, biometricEnabled);
  const profileKey = getSavedAccessProfileKey(profile);
  const profiles = await readSavedAccessProfiles(storage);
  const existing = profiles.find((item) => getSavedAccessProfileKey(item) === profileKey);
  const nextProfile = {
    ...profile,
    biometricEnabled: biometricEnabled || existing?.biometricEnabled || false,
    favorite: existing?.favorite ?? false,
  } satisfies SavedAccessProfile;
  await storage.setItem(
    SAVED_ACCESS_PROFILE_KEY,
    JSON.stringify([nextProfile, ...profiles.filter((item) => getSavedAccessProfileKey(item) !== profileKey)]),
  );
  return nextProfile;
}

export async function updateSavedAccessProfile(
  profile: SavedAccessProfile,
  changes: Partial<Pick<SavedAccessProfile, 'biometricEnabled' | 'favorite'>>,
  storage: SecureStorage = secureStorage,
) {
  const profileKey = getSavedAccessProfileKey(profile);
  const profiles = await readSavedAccessProfiles(storage);
  const nextProfiles = profiles.map((item) =>
    getSavedAccessProfileKey(item) === profileKey ? { ...item, ...changes } : item,
  );
  await storage.setItem(SAVED_ACCESS_PROFILE_KEY, JSON.stringify(nextProfiles));
  return nextProfiles.find((item) => getSavedAccessProfileKey(item) === profileKey) ?? null;
}

export async function updateSavedAccessProfilesUser(
  userId: string,
  changes: Partial<Pick<SavedAccessProfile['user'], 'name' | 'foto'>>,
  storage: SecureStorage = secureStorage,
) {
  const profiles = await readSavedAccessProfiles(storage);
  const nextProfiles = profiles.map((profile) =>
    profile.user.id === userId ? { ...profile, user: { ...profile.user, ...changes } } : profile,
  );
  await storage.setItem(SAVED_ACCESS_PROFILE_KEY, JSON.stringify(nextProfiles));
  return nextProfiles;
}

export async function writeBiometricSession(session: PersistedSession, storage: SecureStorage = secureStorage) {
  const profile = profileFromSession(session, true);
  await storage.setItem(biometricSessionKey(profile), JSON.stringify(session), biometricStorageOptions);
  const savedProfile = await writeSavedAccessProfile(session, true, storage);
  await storage.deleteItem(SESSION_STORAGE_KEY);
  return savedProfile;
}

export async function readBiometricSession(profile: SavedAccessProfile, storage: SecureStorage = secureStorage) {
  const key = biometricSessionKey(profile);
  let raw = await storage.getItem(key, biometricStorageOptions);
  let fromLegacyKey = false;
  if (!raw) {
    raw = await storage.getItem(LEGACY_BIOMETRIC_SESSION_KEY, biometricStorageOptions);
    fromLegacyKey = Boolean(raw);
  }
  if (!raw) return null;

  try {
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      await clearBiometricSession(profile, storage);
      return null;
    }
    if (
      parsed.data.user.id !== profile.user.id ||
      (parsed.data.activeContaId ?? parsed.data.user.contaId) !==
        (profile.activeContaId ?? profile.user.contaId)
    ) {
      return null;
    }
    if (fromLegacyKey) {
      await storage.setItem(key, raw, biometricStorageOptions);
      await storage.deleteItem(LEGACY_BIOMETRIC_SESSION_KEY);
    }
    return parsed.data satisfies PersistedSession;
  } catch {
    await clearBiometricSession(profile, storage);
    return null;
  }
}

export async function clearBiometricSession(profile: SavedAccessProfile, storage: SecureStorage = secureStorage) {
  await storage.deleteItem(biometricSessionKey(profile));
  return updateSavedAccessProfile(profile, { biometricEnabled: false }, storage);
}

export async function removeSavedAccessProfile(profile: SavedAccessProfile, storage: SecureStorage = secureStorage) {
  await storage.deleteItem(biometricSessionKey(profile));
  const profileKey = getSavedAccessProfileKey(profile);
  const profiles = await readSavedAccessProfiles(storage);
  const remaining = profiles.filter((item) => getSavedAccessProfileKey(item) !== profileKey);
  if (remaining.length === 0) {
    await storage.deleteItem(SAVED_ACCESS_PROFILE_KEY);
  } else {
    await storage.setItem(SAVED_ACCESS_PROFILE_KEY, JSON.stringify(remaining));
  }
  return remaining;
}

export async function clearAllSavedAccessProfiles(storage: SecureStorage = secureStorage) {
  const profiles = await readSavedAccessProfiles(storage);
  await Promise.all(profiles.map((profile) => storage.deleteItem(biometricSessionKey(profile))));
  await storage.deleteItem(LEGACY_BIOMETRIC_SESSION_KEY);
  await storage.deleteItem(SAVED_ACCESS_PROFILE_KEY);
}
