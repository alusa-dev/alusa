import type { CorridorUnionGroup, LevelRenderStackItem, MapSelection, MapSelectionItem } from '@alusa/domain';
import type { RefObject } from 'react';
import type Konva from 'konva';
import type { EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../../api/event-map-service';
import type { SeatGroupResizeStartState } from '../../components/SeatGroupResizeHandles';
import { getTextEditorDimensions } from './text-editor-layout';
import type { TextEditorState } from './text-editor-layout';

export type MapCanvasRenderHandlers = {
  isObjectSelected: (object: EventMapObjectDTO) => boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>, item: MapSelectionItem) => void;
  onDoubleClickSelectIndividualSeat: (seatId: string) => void;
  onDragStart: (nodeId: string, item?: MapSelectionItem) => void;
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (
    nodeId: string,
    event: Konva.KonvaEventObject<DragEvent>,
    onCommit: (x: number, y: number) => void,
  ) => void;
  onObjectTransformEnd: (object: EventMapObjectDTO, node: Konva.Node) => void;
  onSeatGroupTransformEnd: (group: EventSeatGroupDTO, node: Konva.Node) => void;
  onUpdateObjectPosition: (objectId: string, x: number, y: number) => void;
  onUpdateSeatPosition: (seatId: string, x: number, y: number) => void;
  onUpdateSeatGroupPosition: (groupId: string, x: number, y: number) => void;
  onOpenTextEditor: (object: EventMapObjectDTO, node: Konva.Text) => void;
  onSeatGroupResizeStart: (state: SeatGroupResizeStartState) => void;
};

export type MapCanvasRenderState = {
  renderStack: LevelRenderStackItem[];
  displayLevelObjects: EventMapObjectDTO[];
  levelSeats: EventSeatDTO[];
  levelSeatGroups: EventSeatGroupDTO[];
  corridorUnionGroups: CorridorUnionGroup[];
  selection: MapSelection;
  selectedCorridorIds: Set<string>;
  activeUnionDragIds: Set<string>;
  levelObjects: EventMapObjectDTO[];
  textEditorObjectId: string | null;
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  zoom: number;
  isTransformSessionActive: boolean;
  isSingleSelectionTransform: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  getPointerPoint: () => { x: number; y: number } | null;
};

export function getMapPointerPoint(
  stageRef: RefObject<Konva.Stage | null>,
  pan: { x: number; y: number },
  zoom: number,
) {
  const stage = stageRef.current;
  const pointer = stage?.getPointerPosition();
  if (!pointer) return null;
  return {
    x: (pointer.x - pan.x) / zoom,
    y: (pointer.y - pan.y) / zoom,
  };
}

export function buildMapCanvasRenderState(input: {
  renderStack: LevelRenderStackItem[];
  displayLevelObjects: EventMapObjectDTO[];
  levelSeats: EventSeatDTO[];
  levelSeatGroups: EventSeatGroupDTO[];
  corridorUnionGroups: CorridorUnionGroup[];
  selection: MapSelection;
  selectedCorridorIds: Set<string>;
  activeUnionDragIds: Set<string>;
  levelObjects: EventMapObjectDTO[];
  textEditorObjectId: string | null;
  placementToolActive: boolean;
  readOnly: boolean;
  tool: string;
  zoom: number;
  isTransformSessionActive: boolean;
  isSingleSelectionTransform: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  getPointerPoint: () => { x: number; y: number } | null;
}): MapCanvasRenderState {
  return input;
}

export function buildMapCanvasRenderHandlers(input: MapCanvasRenderHandlers): MapCanvasRenderHandlers {
  return input;
}

export function buildTextEditorOverlayDimensions(textEditor: TextEditorState | null) {
  if (!textEditor) return null;
  return getTextEditorDimensions({
    textMode: textEditor.textMode,
    value: textEditor.value,
    fontSize: textEditor.fontSize,
    fontFamily: textEditor.fontFamily,
    fontWeight: textEditor.fontWeight,
    letterSpacing: textEditor.letterSpacing,
    lineHeight: textEditor.lineHeight,
    width: textEditor.width,
    height: textEditor.height,
    minHeight: textEditor.minHeight,
  });
}
