import { describe, expect, it } from 'vitest';

import {
  canEditEventMapDraft,
  decideEventMapDeletion,
  isPublicEventMapVisible,
  validatePublicSeatSelection,
  validateEventMapStatusTransition,
  validatePublishableEventMap,
} from './map-rules';

describe('event map rules', () => {
  it('allows draft maps to be published', () => {
    expect(validateEventMapStatusTransition('DRAFT', 'PUBLISHED').ok).toBe(true);
  });

  it('blocks published maps from returning to draft', () => {
    const result = validateEventMapStatusTransition('PUBLISHED', 'DRAFT');
    expect(result.ok).toBe(false);
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

  it('archives maps with orders but allows hard deleting published maps without orders', () => {
    expect(decideEventMapDeletion({ status: 'DRAFT', versionsCount: 0, ordersCount: 0 })).toEqual({
      action: 'DELETE',
    });
    expect(decideEventMapDeletion({ status: 'PUBLISHED', versionsCount: 1, ordersCount: 0 }).action).toBe('DELETE');
    expect(decideEventMapDeletion({ status: 'DRAFT', versionsCount: 1, ordersCount: 2 }).action).toBe('ARCHIVE');
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
