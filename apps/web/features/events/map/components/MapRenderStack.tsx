import { findMapSeatOwner } from '@alusa/domain';
import type { MapCanvasRenderHandlers, MapCanvasRenderState } from '../canvas/render/map-canvas-render-model';
import type { EventMapObjectDTO } from '../api/event-map-service';
import { LooseSeatNode } from './LooseSeatNode';
import { ShapeMapObjectNode } from './ShapeMapObjectNode';
import { TextMapObjectNode } from './TextMapObjectNode';


export type { MapCanvasRenderHandlers, MapCanvasRenderState } from '../canvas/render/map-canvas-render-model';

export function MapObjectNode({
  object,
  state,
  handlers,
}: {
  object: EventMapObjectDTO;
  state: MapCanvasRenderState;
  handlers: MapCanvasRenderHandlers;
}) {
  // A seated section is a logical container, not an independent canvas shape.
  // Its visible boundary is rendered from the current seat geometry below.
  if (object.type === 'SECTION') return null;

  if (object.type === 'TEXT') {
    return (
      <TextMapObjectNode
        object={object}
        hiddenByEditor={state.textEditorObjectId === object.id}
        placementToolActive={state.placementToolActive}
        readOnly={state.readOnly}
        tool={state.tool}
        isSingleSelectionTransform={state.isSingleSelectionTransform}
        onSelect={handlers.onSelect}
        onOpenEditor={handlers.onOpenTextEditor}
        onDragStart={handlers.onDragStart}
        onDragMove={handlers.onDragMove}
        onDragEnd={handlers.onDragEnd}
        onTransformEnd={handlers.onObjectTransformEnd}
        onCommitPosition={(x, y) => handlers.onUpdateObjectPosition(object.id, x, y)}
      />
    );
  }

  return (
    <ShapeMapObjectNode
      object={object}
      selected={handlers.isObjectSelected(object)}
      placementToolActive={state.placementToolActive}
      readOnly={state.readOnly}
      tool={state.tool}
      isSingleSelectionTransform={state.isSingleSelectionTransform}
      onSelect={handlers.onSelect}
      onDragStart={handlers.onDragStart}
      onDragMove={handlers.onDragMove}
      onDragEnd={handlers.onDragEnd}
      onTransformEnd={handlers.onObjectTransformEnd}
      onCommitPosition={(x, y) => handlers.onUpdateObjectPosition(object.id, x, y)}
    />
  );
}

export function MapRenderStack({
  state,
  handlers,
}: {
  state: MapCanvasRenderState;
  handlers: MapCanvasRenderHandlers;
}) {
  return (
    <>
      {state.renderStack.map((item) => {
        if (item.kind === 'seat') {
          const seat = state.levelSeats.find((entry) => entry.id === item.id);
          if (!seat) return null;
          return (
            <LooseSeatNode
              key={seat.id}
              seat={seat}
              selection={state.selection}
              parametricOwner={state.document ? findMapSeatOwner(state.document, seat.id) : null}
              placementToolActive={state.placementToolActive}
              readOnly={state.readOnly}
              tool={state.tool}
              onSelect={handlers.onSelect}
              onDoubleClickSelectIndividual={handlers.onDoubleClickSelectIndividualSeat}
              onDragStart={handlers.onDragStart}
              onDragMove={handlers.onDragMove}
              onDragEnd={handlers.onDragEnd}
              onCommitPosition={(x, y) => handlers.onUpdateSeatPosition(seat.id, x, y)}
            />
          );
        }

        const object = state.displayLevelObjects.find((entry) => entry.id === item.id);
        if (!object) return null;
        return <MapObjectNode key={object.id} object={object} state={state} handlers={handlers} />;
      })}
    </>
  );
}
