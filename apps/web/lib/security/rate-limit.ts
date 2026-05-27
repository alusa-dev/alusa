import { ipFromRequest, rateLimit } from '@/lib/rate-limit';

export type RateLimitProfile =
  | 'LOGIN'
  | 'PASSWORD_RESET'
  | 'INVITE'
  | 'PRIVACY_EXPORT'
  | 'PRIVACY_REQUEST'
  | 'FINANCIAL_TRANSFER'
  | 'ASAAS_API_KEY_ROTATION'
  | 'WEBHOOK'
  | 'DEVELOPER_ADMIN';

const RATE_LIMITS: Record<RateLimitProfile, { limit: number; windowMs: number }> = {
  LOGIN: { limit: 20, windowMs: 15 * 60 * 1000 },
  PASSWORD_RESET: { limit: 8, windowMs: 15 * 60 * 1000 },
  INVITE: { limit: 30, windowMs: 15 * 60 * 1000 },
  PRIVACY_EXPORT: { limit: 4, windowMs: 60 * 60 * 1000 },
  PRIVACY_REQUEST: { limit: 6, windowMs: 60 * 60 * 1000 },
  FINANCIAL_TRANSFER: { limit: 10, windowMs: 10 * 60 * 1000 },
  ASAAS_API_KEY_ROTATION: { limit: 5, windowMs: 60 * 60 * 1000 },
  WEBHOOK: { limit: 600, windowMs: 60 * 1000 },
  DEVELOPER_ADMIN: { limit: 20, windowMs: 15 * 60 * 1000 },
};

export function isPersistentRateLimitConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function checkSecurityRateLimit(req: Request, profile: RateLimitProfile, scope?: string) {
  const config = RATE_LIMITS[profile];
  const ip = ipFromRequest(req);
  return rateLimit(`security:${profile}:${scope ?? 'global'}:${ip}`, config.limit, config.windowMs);
}
