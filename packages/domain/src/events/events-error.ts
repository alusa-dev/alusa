/** Stable event-domain error shared by domain services, finance use cases, and HTTP adapters. */
export class EventsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EventsError';
    void this.code;
    void this.status;
    void this.details;
  }
}
