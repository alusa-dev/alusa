import { measureTextWidth } from '@alusa/domain';
import type { TextMode } from '@alusa/domain';

import type Konva from 'konva';

export const TEXT_EDITOR_PLACEHOLDER = 'Digite aqui…';

export type TextEditorState = {
  objectId: string | null;
  value: string;
  mapX: number;
  mapY: number;
  mapWidth: number | null;
  mapHeight: number | null;
  textMode: TextMode;
  rotation: number;
  left: number;
  top: number;
  width: number | 'auto';
  height: number | 'auto';
  minHeight: number;
  fontSize: number;
  baseFontSize: number;
  fontFamily: string;
  fontWeight: string;
  letterSpacing: number;
  color: string;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
  transform?: string;
};

export type BuildTextEditorStateParams = {
  objectId: string | null;
  value: string;
  mapX: number;
  mapY: number;
  mapWidth: number | null;
  mapHeight: number | null;
  textMode: TextMode;
  rotation: number;
  baseFontSize: number;
  fontFamily: string;
  fontWeight: string;
  letterSpacing: number;
  color: string;
  lineHeight: number;
  textAlign: 'left' | 'center' | 'right';
  stage: Konva.Stage;
  container: HTMLElement;
  zoom: number;
  pan: { x: number; y: number };
  node?: Konva.Text | null;
};

export function buildTextEditorState(params: BuildTextEditorStateParams): TextEditorState {
  const layout = computeTextEditorLayout({
    mapX: params.mapX,
    mapY: params.mapY,
    mapWidth: params.mapWidth,
    mapHeight: params.mapHeight,
    textMode: params.textMode,
    value: params.value,
    fontSize: params.baseFontSize,
    fontFamily: params.fontFamily,
    fontWeight: params.fontWeight,
    letterSpacing: params.letterSpacing,
    lineHeight: params.lineHeight,
    rotation: params.rotation,
    zoom: params.zoom,
    pan: params.pan,
    stage: params.stage,
    container: params.container,
    node: params.node,
  });

  return {
    objectId: params.objectId,
    value: params.value,
    mapX: params.mapX,
    mapY: params.mapY,
    mapWidth: params.mapWidth,
    mapHeight: params.mapHeight,
    textMode: params.textMode,
    rotation: params.rotation,
    left: layout.left,
    top: layout.top,
    width: layout.width,
    height: layout.height,
    minHeight: layout.minHeight,
    fontSize: layout.fontSize,
    baseFontSize: params.baseFontSize,
    fontFamily: params.fontFamily,
    fontWeight: params.fontWeight,
    letterSpacing: params.letterSpacing,
    color: params.color,
    lineHeight: params.lineHeight,
    textAlign: params.textAlign,
    transform: layout.transform,
  };
}

function measureEditorContentWidth(
  value: string,
  fontSize: number,
  options: {
    fontFamily?: string;
    fontWeight?: string;
    letterSpacing?: number;
  },
) {
  const sample = value.trim() ? value : TEXT_EDITOR_PLACEHOLDER;
  return measureTextWidth(sample, fontSize, options);
}

export type TextEditorLayoutInput = {
  mapX: number;
  mapY: number;
  mapWidth: number | null;
  mapHeight: number | null;
  textMode: TextMode;
  value: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  letterSpacing: number;
  lineHeight: number;
  rotation: number;
  zoom: number;
  pan: { x: number; y: number };
  stage: Konva.Stage;
  container: HTMLElement;
  node?: Konva.Text | null;
};

export type TextEditorLayout = {
  left: number;
  top: number;
  width: number | 'auto';
  height: number | 'auto';
  minHeight: number;
  fontSize: number;
  transform?: string;
};

export function computeTextEditorLayout(input: TextEditorLayoutInput): TextEditorLayout {
  const stageBox = input.stage.container().getBoundingClientRect();
  const containerBox = input.container.getBoundingClientRect();
  const scaledFontSize = input.fontSize * input.zoom;
  const isBoxMode = input.textMode !== 'auto';

  let absoluteX: number;
  let absoluteY: number;

  if (input.node) {
    const absolutePosition = input.node.getAbsolutePosition();
    absoluteX = absolutePosition.x;
    absoluteY = absolutePosition.y;
  } else {
    absoluteX = input.mapX * input.zoom + input.pan.x;
    absoluteY = input.mapY * input.zoom + input.pan.y;
  }

  const measuredWidth = measureEditorContentWidth(input.value, input.fontSize, {
    fontFamily: input.fontFamily,
    fontWeight: input.fontWeight,
    letterSpacing: input.letterSpacing,
  });

  const boxWidth = isBoxMode
    ? Math.max(80, (input.mapWidth ?? input.node?.width() ?? measuredWidth) * input.zoom)
    : Math.max(scaledFontSize, measuredWidth * input.zoom);

  const lineCount = Math.max(1, input.value.split('\n').length);
  const autoHeight = Math.max(scaledFontSize * input.lineHeight, lineCount * scaledFontSize * input.lineHeight);
  const boxHeight = isBoxMode
    ? Math.max(
        scaledFontSize * input.lineHeight,
        (input.mapHeight ?? input.node?.height() ?? autoHeight / input.zoom) * input.zoom,
      )
    : autoHeight;

  const layout: TextEditorLayout = {
    left: stageBox.left - containerBox.left + absoluteX,
    top: stageBox.top - containerBox.top + absoluteY,
    width: isBoxMode ? boxWidth : 'auto',
    height: input.textMode === 'area' ? boxHeight : 'auto',
    minHeight: Math.max(scaledFontSize * input.lineHeight, boxHeight),
    fontSize: scaledFontSize,
  };

  if (Math.abs(input.rotation) > 0.01) {
    layout.transform = `rotateZ(${input.rotation}deg)`;
  }

  return layout;
}

export function getTextEditorDimensions(
  editor: {
    textMode: TextMode;
    value: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    letterSpacing: number;
    lineHeight: number;
    width: number | 'auto';
    height: number | 'auto';
    minHeight: number;
  },
) {
  if (editor.textMode !== 'auto') {
    return {
      width:
        editor.width === 'auto'
          ? measureEditorContentWidth(editor.value, editor.fontSize, {
              fontFamily: editor.fontFamily,
              fontWeight: editor.fontWeight,
              letterSpacing: editor.letterSpacing,
            }) * 1.05
          : editor.width,
      height: editor.height === 'auto' ? undefined : editor.height,
    };
  }

  const lines = editor.value.split('\n');
  const longestLine = lines.reduce((longest, line) => (line.length > longest.length ? line : longest), '');
  const lineCount = Math.max(1, lines.length);

  return {
    width: measureEditorContentWidth(longestLine, editor.fontSize, {
      fontFamily: editor.fontFamily,
      fontWeight: editor.fontWeight,
      letterSpacing: editor.letterSpacing,
    }),
    height: Math.max(editor.minHeight, lineCount * editor.fontSize * editor.lineHeight),
  };
}
