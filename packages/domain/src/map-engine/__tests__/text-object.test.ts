import { applyTextModePatch, getTextDecorationValue, getTextDimensionsForMode, getTextMode, getTextModeFromCreation, getTextResizeAnchors, getTextWrap, measureTextWidth } from '../index';
import type { EventMapObjectDTO } from '../index';

import { describe, expect, it } from 'vitest';

function textObject(partial: Partial<EventMapObjectDTO> & Pick<EventMapObjectDTO, 'width' | 'height'>): EventMapObjectDTO {
  return {
    id: 'text-1',
    levelId: 'level-1',
    sectionId: null,
    type: 'TEXT',
    data: {},
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
    ...partial,
  };
}

describe('text-object', () => {
  it('infers text mode from stored data and legacy dimensions', () => {
    expect(getTextMode(textObject({ width: null, height: null, data: { textMode: 'auto' } }))).toBe('auto');
    expect(getTextMode(textObject({ width: 200, height: null, data: {} }))).toBe('fixed-width');
    expect(getTextMode(textObject({ width: 200, height: 80, data: {} }))).toBe('area');
    expect(getTextMode(textObject({ width: null, height: null, data: {} }))).toBe('auto');
  });

  it('maps creation gestures to text modes', () => {
    expect(getTextModeFromCreation(null, null)).toBe('auto');
    expect(getTextModeFromCreation(180, null)).toBe('fixed-width');
    expect(getTextModeFromCreation(180, 60)).toBe('area');
  });

  it('returns dimensions and wrap rules per mode', () => {
    expect(getTextDimensionsForMode('auto')).toEqual({ width: null, height: null });
    expect(getTextDimensionsForMode('fixed-width', 220)).toEqual({ width: 220, height: null });
    expect(getTextDimensionsForMode('area', 220, 90)).toEqual({ width: 220, height: 90 });
    expect(getTextWrap('auto')).toBe('none');
    expect(getTextWrap('fixed-width')).toBe('word');
  });

  it('exposes resize anchors per mode', () => {
    expect(getTextResizeAnchors('auto')).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
    expect(getTextResizeAnchors('fixed-width')).toContain('middle-left');
    expect(getTextResizeAnchors('area')).toContain('top-center');
  });

  it('applies text mode patches with normalized dimensions', () => {
    const object = textObject({ width: 200, height: 80, data: { text: 'Hello' } });
    expect(applyTextModePatch('auto', object)).toEqual({
      width: null,
      height: null,
      data: { text: 'Hello', textMode: 'auto' },
    });
    expect(applyTextModePatch('fixed-width', textObject({ width: null, height: null, data: {} }))).toMatchObject({
      width: 160,
      height: null,
      data: { textMode: 'fixed-width' },
    });
  });

  it('supports combined underline and strikethrough decorations', () => {
    expect(getTextDecorationValue({ underline: true, lineThrough: true })).toBe('underline line-through');
    expect(getTextDecorationValue({ textDecoration: 'underline' })).toBe('underline');
  });

  it('measures text width with a deterministic fallback outside the browser', () => {
    expect(measureTextWidth('abc', 20)).toBeGreaterThan(0);
    expect(measureTextWidth('abc', 20)).toBe(measureTextWidth('abc', 20));
  });
});
