import { getTextDecorationValue, SNAP_TARGET_NAME, buildTextFontStyle, clampFontSizeValue, getTextMode, getTextWrap, isTextBoxMode, type MapSelectionItem } from '@alusa/domain';
import type { EventMapObjectDTO } from '../api/event-map-service';

import Konva from 'konva';
import { Text } from 'react-konva';

export type TextMapObjectNodeProps = {
  object: EventMapObjectDTO;
  hiddenByEditor: boolean;
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  isSingleSelectionTransform: boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>, item: MapSelectionItem) => void;
  onOpenEditor: (object: EventMapObjectDTO, node: Konva.Text) => void;
  onDragStart: (nodeId: string, item: MapSelectionItem) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (nodeId: string, event: Konva.KonvaEventObject<DragEvent>, onCommit: (x: number, y: number) => void) => void;
  onTransformEnd: (object: EventMapObjectDTO, node: Konva.Node) => void;
  onCommitPosition: (x: number, y: number) => void;
};

export function TextMapObjectNode({
  object,
  hiddenByEditor,
  placementToolActive,
  readOnly,
  tool,
  isSingleSelectionTransform,
  onSelect,
  onOpenEditor,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onCommitPosition,
}: TextMapObjectNodeProps) {
  const textMode = getTextMode(object);
  const textStrokeWidth = Number(object.data.strokeWidth ?? 0);
  const textStroke = String(object.data.stroke ?? '#000000');
  const textWidth = isTextBoxMode(object) ? object.width ?? undefined : undefined;
  const hasCustomHeight = textMode === 'area' && typeof object.height === 'number' && object.height > 0;
  const fontSize = clampFontSizeValue(Number(object.data.fontSize ?? 22));
  const lineHeight = Number(object.data.lineHeight ?? 1.2);

  return (
    <Text
      key={object.id}
      id={`node-${object.id}`}
      x={object.x}
      y={object.y}
      scaleX={1}
      scaleY={1}
      text={String(object.data.text ?? 'Texto')}
      width={textWidth}
      height={hasCustomHeight ? object.height ?? undefined : undefined}
      fontFamily={String(object.data.fontFamily ?? 'Inter, sans-serif')}
      fontSize={fontSize}
      fontStyle={buildTextFontStyle(object.data)}
      textDecoration={getTextDecorationValue(object.data)}
      align={String(object.data.align ?? 'left') as Konva.TextConfig['align']}
      verticalAlign={String(object.data.verticalAlign ?? 'top') as Konva.TextConfig['verticalAlign']}
      lineHeight={lineHeight}
      letterSpacing={Number(object.data.letterSpacing ?? 0)}
      fill={String(object.data.fill ?? '#0f172a')}
      opacity={Number(object.data.opacity ?? 1)}
      stroke={textStrokeWidth > 0 ? textStroke : undefined}
      strokeWidth={textStrokeWidth}
      strokeScaleEnabled={false}
      wrap={getTextWrap(textMode)}
      rotation={object.rotation}
      name={SNAP_TARGET_NAME}
      listening={!placementToolActive}
      draggable={!readOnly && !placementToolActive && tool !== 'pan' && tool !== 'zoom' && !object.locked}
      onClick={(event) => onSelect(event, { type: 'object', id: object.id })}
      onDblClick={(event) => {
        event.cancelBubble = true;
        onOpenEditor(object, event.target as Konva.Text);
      }}
      visible={!hiddenByEditor}
      onDragStart={() => onDragStart(`node-${object.id}`, { type: 'object', id: object.id })}
      onDragMove={onDragMove}
      onDragEnd={(event) => onDragEnd(`node-${object.id}`, event, onCommitPosition)}
      onTransformEnd={(event) => {
        if (isSingleSelectionTransform) onTransformEnd(object, event.target);
      }}
    />
  );
}
