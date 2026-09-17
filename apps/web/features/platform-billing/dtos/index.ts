import { z } from 'zod';

const webhookStatusDTOSchema = z.enum(['FAILED', 'EXHAUSTED', 'PENDING', 'PROCESSING']);

function boundedLimitDTOSchema(fallback: number, max: number) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed === 0) return fallback;
      return Math.max(1, Math.min(max, Math.trunc(parsed)));
    },
    z.number().int().min(1).max(max),
  );
}

export const platformBillingWebhookListQueryDTOSchema = z.object({
  status: z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value
            .map((item) => String(item).toUpperCase())
            .filter((item): item is z.infer<typeof webhookStatusDTOSchema> =>
              webhookStatusDTOSchema.safeParse(item).success,
            )
        : undefined,
    z.array(webhookStatusDTOSchema).default(['FAILED', 'EXHAUSTED']),
  ),
  limit: boundedLimitDTOSchema(50, 100),
});

export const platformBillingWebhookReplayInputDTOSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(100),
  reason: z.string().trim().min(5).max(500),
});

export const platformBillingPortalInputDTOSchema = z.object({
  returnPath: z.string().optional(),
});

export * from './platform-billing-summary';
