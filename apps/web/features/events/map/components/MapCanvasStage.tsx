import type { LevelBounds } from '@alusa/domain';
import type { RefObject } from 'react';
import type Konva from 'konva';
import { Layer, Rect, Stage } from 'react-konva';
import type { MapTool } from '../store/event-map-editor-store';
import type { TransformerScaleOptions } from '../canvas/transform/transform-handle-mode';
import { getNodeBounds } from '../canvas/adapters/konva-snap-adapter';
import type { MapCanvasRenderHandlers, MapCanvasRenderState } from '../canvas/render/map-canvas-render-model';
import type { CreationDraft, MarqueeDraft, SeatGridDraft } from '../canvas/render/map-creation-draft';
import type { SeatGridPreviewSeat } from '@alusa/domain';
import type { SnapGuidesLayerHandle } from './SnapGuidesLayer';
import { MapCreationPreview } from './MapCreationPreview';
import { MapMarqueePreview } from './MapMarqueePreview';
import { MapRenderStack } from './MapRenderStack';
import { MapTransformer } from './MapTransformer';
import { SeatGridPreviewLayer } from './SeatGridPreviewLayer';
import { SnapGuidesLayer } from './SnapGuidesLayer';

type MapCanvasStageProps = {
  stageRef: RefObject<Konva.Stage | null>;
  contentLayerRef: RefObject<Konva.Layer | null>;
  guidesLayerRef: RefObject<SnapGuidesLayerHandle | null>;
  transformerRef: RefObject<Konva.Transformer | null>;
  size: { width: number; height: number };
  level: { widthPx: number; heightPx: number };
  pan: { x: number; y: number };
  zoom: number;
  readOnly: boolean;
  tool: MapTool;
  renderState: MapCanvasRenderState;
  renderHandlers: MapCanvasRenderHandlers;
  creationDraft: CreationDraft | null;
  marqueeDraft: MarqueeDraft | null;
  seatGridDraft: SeatGridDraft | null;
  seatGridPreviewSeats: SeatGridPreviewSeat[];
  disableRotateForMixedSmartCorridorSelection: boolean;
  disableResizeForMixedSmartCorridorSelection: boolean;
  transformerScaleOptions: TransformerScaleOptions;
  selectedTextTransformAnchors: readonly string[];
  placementToolActive: boolean;
  levelBounds: LevelBounds | null;
  selectedNodeIds: string[];
  handleAnchorDragBound: (
    newAbs: { x: number; y: number },
    context: {
      anchor: string;
      contentLayer: Konva.Layer;
      skipIds: string[];
      referenceBox: ReturnType<typeof getNodeBounds>;
      snapDisabled: boolean;
    },
  ) => { x: number; y: number };
  onStagePanStart: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onStageDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onStageDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onMouseDown: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseMove: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onMouseUp: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onWheel: (event: Konva.KonvaEventObject<WheelEvent>) => void;
};

export function MapCanvasStage({
  stageRef,
  contentLayerRef,
  guidesLayerRef,
  transformerRef,
  size,
  level,
  pan,
  zoom,
  readOnly,
  tool,
  renderState,
  renderHandlers,
  creationDraft,
  marqueeDraft,
  seatGridDraft,
  seatGridPreviewSeats,
  disableRotateForMixedSmartCorridorSelection,
  disableResizeForMixedSmartCorridorSelection,
  transformerScaleOptions,
  selectedTextTransformAnchors,
  placementToolActive,
  levelBounds,
  selectedNodeIds,
  handleAnchorDragBound,
  onStagePanStart,
  onStageDragMove,
  onStageDragEnd,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
}: MapCanvasStageProps) {
  return (
    <Stage
      ref={stageRef as RefObject<Konva.Stage>}
      width={size.width}
      height={size.height}
      x={pan.x}
      y={pan.y}
      scaleX={zoom}
      scaleY={zoom}
      draggable={!readOnly && tool === 'pan'}
      onDragStart={onStagePanStart}
      onDragMove={onStageDragMove}
      onDragEnd={onStageDragEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onWheel={onWheel}
    >
      <Layer listening={false}>
        <Rect x={0} y={0} width={level.widthPx} height={level.heightPx} fill="#ffffff" stroke="#cbd5e1" strokeWidth={2} />
      </Layer>

      <Layer ref={contentLayerRef as RefObject<Konva.Layer>}>
        <MapRenderStack state={renderState} handlers={renderHandlers} />
        <SeatGridPreviewLayer seatGridDraft={seatGridDraft} seatGridPreviewSeats={seatGridPreviewSeats} />
        <MapTransformer
          transformerRef={transformerRef}
          disableRotateForMixedSmartCorridorSelection={disableRotateForMixedSmartCorridorSelection}
          disableResizeForMixedSmartCorridorSelection={disableResizeForMixedSmartCorridorSelection}
          transformerScaleOptions={transformerScaleOptions}
          selectedTextTransformAnchors={selectedTextTransformAnchors}
          placementToolActive={placementToolActive}
          readOnly={readOnly}
          tool={tool}
          levelBounds={levelBounds}
          selectedNodeIds={selectedNodeIds}
          handleAnchorDragBound={handleAnchorDragBound}
        />
        <MapCreationPreview creationDraft={creationDraft} />
        <MapMarqueePreview marqueeDraft={marqueeDraft} />
        <SnapGuidesLayer ref={guidesLayerRef as RefObject<SnapGuidesLayerHandle>} zoom={zoom} />
      </Layer>
    </Stage>
  );
}
