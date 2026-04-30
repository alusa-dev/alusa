type LoginAttempt = {
  count: number;
  resetAt: number;
};

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, LoginAttempt>();

function now() {
  return Date.now();
}

function readEntry(key: string): LoginAttempt {
  const current = attempts.get(key);
  const timestamp = now();

  if (!current || current.resetAt <= timestamp) {
    const fresh = { count: 0, resetAt: timestamp + WINDOW_MS };
    attempts.set(key, fresh);
    return fresh;
  }

  return current;
}

export function getGlobalAdminRateLimitState(key: string) {
  const entry = readEntry(key);
  return {
    remaining: Math.max(0, MAX_ATTEMPTS - entry.count),
    resetAt: new Date(entry.resetAt),
    blocked: entry.count >= MAX_ATTEMPTS,
  };
}

export function registerGlobalAdminFailedAttempt(key: string) {
  const entry = readEntry(key);
  entry.count += 1;
  attempts.set(key, entry);
  return getGlobalAdminRateLimitState(key);
}

export function clearGlobalAdminAttempts(key: string) {
  attempts.delete(key);
}
