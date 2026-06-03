export const eventQueryKeys = {
  events: ['events'] as const,
  resources: ['events', 'resources'] as const,
  event: (id: string) => ['events', 'detail', id] as const,
  lots: (id?: string) => ['events', 'lots', id ?? 'all'] as const,
  sales: (id?: string) => ['events', 'sales', id ?? 'all'] as const,
  costumes: (id?: string) => ['events', 'costumes', id ?? 'all'] as const,
  assignments: (id?: string) => ['events', 'assignments', id ?? 'all'] as const,
  finance: (id?: string, type?: string) => ['events', 'finance', id ?? 'all', type ?? 'all'] as const,
  reports: (eventId?: string, compareWithEventId?: string) =>
    ['events', 'reports', eventId ?? 'all', compareWithEventId ?? 'none'] as const,
  audit: (id: string) => ['events', 'audit', id] as const,
};
