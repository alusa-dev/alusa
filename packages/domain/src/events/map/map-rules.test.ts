import { describe, expect, it } from 'vitest';

import {
  canCreateEventMap,
  canEditEventMapDraft,
  decideEventMapDeletion,
  isOperationalEventMapStatus,
  isPublicEventMapVisible,
  MAX_EVENT_MAPS_PER_EVENT,
  resolveActivePublishedEventMap,
  countTicketLotCapacitiesFromMap,
  resolvePublishedMapReplacement,
  sortEventMapsForDisplay,
  validatePublicSeatSelection,
  validateEventMapStatusTransition,
  validatePublishableEventMap,
} from './map-rules';

describe('event map rules', () => {
  it('allows draft maps to be published', () => {
    expect(validateEventMapStatusTransition('DRAFT', 'PUBLISHED').ok).toBe(true);
  });

  it('allows published maps to return to draft for replacement flows', () => {
    expect(validateEventMapStatusTransition('PUBLISHED', 'DRAFT').ok).toBe(true);
  });

  it('enforces the per-event map limit', () => {
    expect(MAX_EVENT_MAPS_PER_EVENT).toBe(5);
    expect(canCreateEventMap(4)).toBe(true);
    expect(canCreateEventMap(5)).toBe(false);
  });

  it('resolves published map replacement by order history', () => {
    expect(resolvePublishedMapReplacement(0)).toBe('DEMOTE_TO_DRAFT');
    expect(resolvePublishedMapReplacement(2)).toBe('ARCHIVE');
  });

  it('sorts maps for display with active first, then templates, then archived', () => {
    const sorted = sortEventMapsForDisplay([
      { id: 'archived', status: 'ARCHIVED', updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'draft', status: 'DRAFT', updatedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'published', status: 'PUBLISHED', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    expect(sorted.map((map) => map.id)).toEqual(['published', 'draft', 'archived']);
  });

  it('resolves the active published map when multiple records exist', () => {
    const active = resolveActivePublishedEventMap([
      { id: 'older', status: 'PUBLISHED', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'newer', status: 'PUBLISHED', updatedAt: '2026-01-03T00:00:00.000Z' },
      { id: 'draft', status: 'DRAFT', updatedAt: '2026-01-04T00:00:00.000Z' },
    ]);

    expect(active?.id).toBe('newer');
  });

  it('requires numbered seats, linked sections and available seats to publish', () => {
    const result = validatePublishableEventMap({
      ticketMode: 'NUMBERED_SEATS',
      levelsCount: 1,
      sections: [{ id: 'section-1', name: 'VIP', lotId: 'lot-1' }],
      seats: [{ id: 'seat-1', sectionId: 'section-1', status: 'AVAILABLE' }],
    });

    expect(result.ok).toBe(true);
  });

  it('returns actionable publish errors', () => {
    const result = validatePublishableEventMap({
      ticketMode: 'SIMPLE',
      levelsCount: 0,
      sections: [{ id: 'section-1', name: 'VIP' }],
      seats: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'O evento precisa usar assentos numerados para publicar um mapa.',
          'Crie pelo menos uma prancheta ou nível.',
          'Todos os setores vendáveis precisam estar vinculados a um lote.',
          'Crie pelo menos um assento.',
        ]),
      );
    }
  });

  it('allows editing a published map as a draft without changing the public version', () => {
    expect(canEditEventMapDraft('DRAFT')).toBe(true);
    expect(canEditEventMapDraft('PUBLISHED')).toBe(true);
    expect(canEditEventMapDraft('ARCHIVED')).toBe(false);
  });

  it('counts sellable seats per linked lot from map sections', () => {
    const capacities = countTicketLotCapacitiesFromMap({
      sections: [
        { id: 'section-a', lotId: 'lot-1' },
        { id: 'section-b', lotId: 'lot-2' },
      ],
      seats: [
        { sectionId: 'section-a', publicVisible: true },
        { sectionId: 'section-a', publicVisible: true },
        { sectionId: 'section-a', publicVisible: false },
        { sectionId: 'section-b', publicVisible: true },
      ],
    });

    expect(capacities.get('lot-1')).toBe(2);
    expect(capacities.get('lot-2')).toBe(1);
  });

  it('archives maps with operational history and only hard-deletes unused drafts', () => {
    expect(decideEventMapDeletion({ status: 'DRAFT', versionsCount: 0, ordersCount: 0 })).toEqual({
      action: 'DELETE',
    });
    expect(decideEventMapDeletion({ status: 'PUBLISHED', versionsCount: 1, ordersCount: 0 }).action).toBe('ARCHIVE');
    expect(decideEventMapDeletion({ status: 'DRAFT', versionsCount: 1, ordersCount: 2 }).action).toBe('ARCHIVE');
    expect(decideEventMapDeletion({ status: 'PUBLISHED', versionsCount: 1, ordersCount: 3 }).action).toBe('ARCHIVE');
  });

  it('hides archived maps from operational status checks', () => {
    expect(isOperationalEventMapStatus('DRAFT')).toBe(true);
    expect(isOperationalEventMapStatus('PUBLISHED')).toBe(true);
    expect(isOperationalEventMapStatus('ARCHIVED')).toBe(false);
  });

  it('validates public seat selections against visibility and availability', () => {
    const result = validatePublicSeatSelection({
      requestedSeatIds: ['seat-1', 'seat-1', 'seat-2'],
      seats: [
        { id: 'seat-1', status: 'AVAILABLE' },
        { id: 'seat-2', status: 'AVAILABLE' },
      ],
      maxSeats: 4,
    });

    expect(result).toEqual({ ok: true, seatIds: ['seat-1', 'seat-2'] });
    expect(
      validatePublicSeatSelection({
        requestedSeatIds: ['seat-1'],
        seats: [{ id: 'seat-1', status: 'SOLD' }],
      }).ok,
    ).toBe(false);
  });

  it('only exposes maps with an active public version', () => {
    expect(isPublicEventMapVisible({ status: 'PUBLISHED', publicEnabled: true, publishedVersionId: 'v1' })).toBe(true);
    expect(isPublicEventMapVisible({ status: 'DRAFT', publicEnabled: true, publishedVersionId: 'v1' })).toBe(false);
    expect(isPublicEventMapVisible({ status: 'PUBLISHED', publicEnabled: false, publishedVersionId: 'v1' })).toBe(false);
  });
});
