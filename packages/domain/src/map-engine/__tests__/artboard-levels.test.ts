import {
  MAP_AREA_HEIGHT_PX,
  MAP_AREA_WIDTH_PX,
  applyArtboardOrientation,
  clampArtboardWidth,
  getArtboardOrientation,
  normalizeArtboardDimensions,
  normalizeMapLevels,
  swapArtboardOrientation,
} from '../index';

describe('artboard levels', () => {
  it('preserves custom artboard dimensions during normalization', () => {
    const normalized = normalizeMapLevels([
      { id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1200, heightPx: 1600, unit: 'px', scale: null },
    ]);

    expect(normalized[0]).toMatchObject({
      widthPx: 1200,
      heightPx: 1600,
      unit: 'px',
    });
  });

  it('clamps artboard dimensions to supported bounds', () => {
    expect(clampArtboardWidth(100)).toBe(320);
    expect(normalizeArtboardDimensions(30000, 100)).toEqual({
      widthPx: 20000,
      heightPx: 240,
    });
  });

  it('detects orientation and swaps dimensions', () => {
    const landscape = { widthPx: 1440, heightPx: 900 };
    const portrait = swapArtboardOrientation(landscape);

    expect(getArtboardOrientation(landscape)).toBe('landscape');
    expect(getArtboardOrientation(portrait)).toBe('portrait');
    expect(portrait).toEqual({ widthPx: 900, heightPx: 1440 });
  });

  it('applies orientation only when needed', () => {
    expect(applyArtboardOrientation({ widthPx: MAP_AREA_WIDTH_PX, heightPx: MAP_AREA_HEIGHT_PX }, 'landscape')).toEqual({
      widthPx: MAP_AREA_WIDTH_PX,
      heightPx: MAP_AREA_HEIGHT_PX,
    });
    expect(applyArtboardOrientation({ widthPx: MAP_AREA_WIDTH_PX, heightPx: MAP_AREA_HEIGHT_PX }, 'portrait')).toEqual({
      widthPx: MAP_AREA_HEIGHT_PX,
      heightPx: MAP_AREA_WIDTH_PX,
    });
  });
});
