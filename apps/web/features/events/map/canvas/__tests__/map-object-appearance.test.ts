import { describe, expect, it } from 'vitest';

import type { EventMapObjectDTO } from '../../api/event-map-service';
import { getObjectAppearance, getObjectStrokeDash, seatFill } from '../render/map-object-appearance';

describe('map-object-appearance', () => {
  it('maps seat status to fill colors', () => {
    expect(seatFill('AVAILABLE')).toBe('#10b981');
    expect(seatFill('SOLD')).toBe('#94a3b8');
  });

  it('derives dashed appearance flags for any map object', () => {
    const object = {
      type: 'GENERAL_AREA',
      data: { strokeStyle: 'dashed', strokeWidth: 2 },
    } as unknown as EventMapObjectDTO;

    expect(getObjectStrokeDash(object)).toEqual([10, 6]);
    expect(getObjectAppearance(object).dash).toEqual([10, 6]);
  });

  it('respects disabled stroke appearance', () => {
    const object = {
      type: 'TABLE',
      data: { strokeEnabled: false, strokeWidth: 4 },
    } as unknown as EventMapObjectDTO;

    expect(getObjectAppearance(object).stroke).toBeUndefined();
    expect(getObjectAppearance(object).strokeWidth).toBe(0);
  });
});
