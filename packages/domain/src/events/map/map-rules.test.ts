import { describe, expect, it } from 'vitest';

import {
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
});
