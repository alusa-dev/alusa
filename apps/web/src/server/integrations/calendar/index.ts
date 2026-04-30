export type CalendarIntegrationProvider = 'google' | 'notion';

export type CalendarSyncEnvelope = {
  internalEventId: string;
  provider: CalendarIntegrationProvider;
  externalEventId?: string | null;
  syncedAt?: Date | null;
};

export interface CalendarIntegrationAdapter {
  provider: CalendarIntegrationProvider;
  pull?: () => Promise<CalendarSyncEnvelope[]>;
  push?: (_payload: CalendarSyncEnvelope) => Promise<void>;
}
