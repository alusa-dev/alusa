import { describe, expect, it } from 'vitest';

import { normalizeMapReferenceChart } from '../model/map-reference-chart.js';

const validReference = {
  url: '/uploads/reference.png',
  storageKey: 'uploads/event-maps/account/map/reference.png',
  fileName: 'reference.png',
  mimeType: 'image/png',
  width: 1200,
  height: 800,
  visible: true,
  opacity: 0.5,
  locked: true,
  transform: { x: 20, y: 30, scale: 0.8, rotation: 0 },
  calibration: { seatDiameter: 24, seatPitch: 8, rowPitch: 18 },
} as const;

describe('map reference chart', () => {
  it('normalizes optional authoring defaults without changing the geometry', () => {
    expect(
      normalizeMapReferenceChart({
        ...validReference,
        opacity: 4,
        visible: undefined,
        locked: undefined,
      }),
    ).toMatchObject({
      opacity: 1,
      visible: true,
      locked: true,
      transform: validReference.transform,
      calibration: validReference.calibration,
    });
  });

  it('rejects malformed or unsafe image metadata', () => {
    expect(normalizeMapReferenceChart({ ...validReference, mimeType: 'image/svg+xml' })).toBeNull();
    expect(normalizeMapReferenceChart({ ...validReference, transform: { ...validReference.transform, scale: 0 } })).toBeNull();
    expect(normalizeMapReferenceChart({ ...validReference, calibration: { seatDiameter: 0, seatPitch: 1, rowPitch: 1 } })).toMatchObject({ calibration: null });
  });
});
