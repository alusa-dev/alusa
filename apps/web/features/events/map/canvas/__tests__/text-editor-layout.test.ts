import { measureTextWidth } from '@alusa/domain';
import { TEXT_EDITOR_PLACEHOLDER, getTextEditorDimensions } from '../render/text-editor-layout';

import { describe, expect, it } from 'vitest';

describe('text-editor-layout', () => {
  it('derives auto-mode dimensions from measured text', () => {
    const dimensions = getTextEditorDimensions({
      textMode: 'auto',
      value: 'Hello',
      fontSize: 22,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'normal',
      letterSpacing: 0,
      lineHeight: 1.2,
      width: 'auto',
      height: 'auto',
      minHeight: 26,
    });

    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThanOrEqual(26);
  });

  it('sizes empty auto-mode editor to fit the placeholder', () => {
    const dimensions = getTextEditorDimensions({
      textMode: 'auto',
      value: '',
      fontSize: 22,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'normal',
      letterSpacing: 0,
      lineHeight: 1.2,
      width: 'auto',
      height: 'auto',
      minHeight: 26,
    });

    const placeholderWidth = measureTextWidth(TEXT_EDITOR_PLACEHOLDER, 22, {
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'normal',
      letterSpacing: 0,
    });

    expect(dimensions.width).toBe(placeholderWidth);
    expect(dimensions.width).toBeGreaterThan(22);
  });

  it('uses fixed box dimensions in box modes', () => {
    const dimensions = getTextEditorDimensions({
      textMode: 'fixed-width',
      value: 'Wrapped text',
      fontSize: 22,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'normal',
      letterSpacing: 0,
      lineHeight: 1.2,
      width: 240,
      height: 'auto',
      minHeight: 26,
    });

    expect(dimensions.width).toBe(240);
    expect(dimensions.height).toBeUndefined();
  });

  it('keeps explicit height for area mode', () => {
    const dimensions = getTextEditorDimensions({
      textMode: 'area',
      value: 'Area text',
      fontSize: 22,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'normal',
      letterSpacing: 0,
      lineHeight: 1.2,
      width: 240,
      height: 120,
      minHeight: 26,
    });

    expect(dimensions.width).toBe(240);
    expect(dimensions.height).toBe(120);
  });
});
