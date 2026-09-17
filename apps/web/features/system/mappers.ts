import {
  adminFinancialHealthResultDTOSchema,
  adminFinancialOperationalHealthResultDTOSchema,
  adminTestCustomerResultDTOSchema,
  appHealthResultDTOSchema,
  devSetPasswordResultDTOSchema,
  devUserResultDTOSchema,
  internalHealthResultDTOSchema,
  testCreateInviteResultDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapAdminTestCustomerResultToDTO(record: Record<string, unknown>) {
  return adminTestCustomerResultDTOSchema.parse(record);
}

export function mapAdminFinancialHealthResultToDTO(record: Record<string, unknown>) {
  const queue = record.queue as Record<string, unknown> | undefined;
  return adminFinancialHealthResultDTOSchema.parse({
    ...record,
    queue: queue
      ? {
          ...queue,
          oldestPendingAt: toIsoString(queue.oldestPendingAt as Date | string | undefined),
          generatedAt:
            toIsoString(queue.generatedAt as Date | string | undefined) ?? new Date(0).toISOString(),
        }
      : undefined,
  });
}

export function mapAdminFinancialOperationalHealthResultToDTO(record: Record<string, unknown>) {
  const result = record.result as {
    generatedAt?: Date | string;
    accounts?: unknown;
  } | undefined;
  const alerts = Array.isArray(record.alerts) ? record.alerts : [];

  return adminFinancialOperationalHealthResultDTOSchema.parse({
    ...record,
    result: {
      ...result,
      generatedAt: toIsoString(result?.generatedAt) ?? new Date(0).toISOString(),
    },
    alerts: alerts.map((alert) => {
      const item = alert as Record<string, unknown>;
      return {
        ...item,
        firstSeenAt: toIsoString(item.firstSeenAt as Date | string | undefined),
        lastSeenAt: toIsoString(item.lastSeenAt as Date | string | undefined),
        resolvedAt: toIsoString(item.resolvedAt as Date | string | null | undefined),
        createdAt: toIsoString(item.createdAt as Date | string | undefined),
        updatedAt: toIsoString(item.updatedAt as Date | string | undefined),
      };
    }),
  });
}

export function mapInternalHealthResultToDTO(record: Record<string, unknown>) {
  return internalHealthResultDTOSchema.parse(record);
}

export function mapAppHealthResultToDTO(record: Record<string, unknown>) {
  return appHealthResultDTOSchema.parse({
    ...record,
    now: toIsoString(record.now as Date | string | undefined),
  });
}

export function mapDevSetPasswordResultToDTO(record: Record<string, unknown>) {
  return devSetPasswordResultDTOSchema.parse(record);
}

export function mapDevUserResultToDTO(record: Record<string, unknown>) {
  return devUserResultDTOSchema.parse(record);
}

export function mapTestCreateInviteResultToDTO(record: Record<string, unknown>) {
  return testCreateInviteResultDTOSchema.parse(record);
}
