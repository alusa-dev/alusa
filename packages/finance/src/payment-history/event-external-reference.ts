export type ParsedEventChargeExternalReference =
  | { kind: 'event-map-order'; entityId: string }
  | { kind: 'event-entry'; entityId: string };

export function parseEventChargeExternalReference(
  externalReference?: string | null,
): ParsedEventChargeExternalReference | null {
  const normalized = externalReference?.trim();
  if (!normalized) return null;

  if (normalized.startsWith('event-map-order:')) {
    const entityId = normalized.slice('event-map-order:'.length);
    return entityId ? { kind: 'event-map-order', entityId } : null;
  }

  if (normalized.startsWith('event-entry:')) {
    const entityId = normalized.slice('event-entry:'.length);
    return entityId ? { kind: 'event-entry', entityId } : null;
  }

  return null;
}

export function isEventChargeExternalReference(externalReference?: string | null): boolean {
  return parseEventChargeExternalReference(externalReference) !== null;
}
