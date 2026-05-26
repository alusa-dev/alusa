import type { CorridorUnionGroup, LevelRenderStackItem, MapSelection, MapSelectionItem } from '@alusa/domain';

import { polygonToKonvaPoints } from '../canvas/adapters/konva-snap-adapter';
import { CORRIDOR_CANVAS_DEFAULT } from '../canvas/render/map-object-appearance';
import type { MapCanvasRenderHandlers, MapCanvasRenderState } from '../canvas/render/map-canvas-render-model';
import type { EventMapObjectDTO, EventSeatDTO, EventSeatGroupDTO } from '../api/event-map-service';
import { CorridorMapObject, buildCorridorMapObjectProps } from './CorridorMapObject';
import { LooseSeatNode } from './LooseSeatNode';
import { SeatGroupNode } from './SeatGroupNode';
import type { SeatGroupResizeStartState } from './SeatGroupResizeHandles';
import { ShapeMapObjectNode } from './ShapeMapObjectNode';
import { TextMapObjectNode } from './TextMapObjectNode';

import Konva from 'konva';
import type { RefObject } from 'react';
import { Group, Line } from 'react-konva';

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
  if (object.type === 'CORRIDOR') {
    const corridorProps = buildCorridorMapObjectProps(object, {
      selection: state.selection,
      levelObjects: state.levelObjects,
      selectedCorridorIds: state.selectedCorridorIds,
      corridorUnionGroups: state.corridorUnionGroups,
      activeUnionDragIds: state.activeUnionDragIds,
      isObjectSelected: handlers.isObjectSelected,
    });
    const freezeFromReact = state.isTransformSessionActive && state.selectedCorridorIds.has(object.id);

    return (
      <CorridorMapObject
        key={object.id}
        {...corridorProps}
        freezeFromReact={freezeFromReact}
        placementToolActive={state.placementToolActive}
        readOnly={state.readOnly}
        tool={state.tool}
        onSelect={(event) => handlers.onSelect(event, { type: 'object', id: object.id })}
        onDragStart={() => handlers.onDragStart(`node-${object.id}`, { type: 'object', id: object.id })}
        onDragMove={handlers.onDragMove}
        onDragEnd={(event) =>
          handlers.onDragEnd(`node-${object.id}`, event, (x, y) => handlers.onUpdateObjectPosition(object.id, x, y))
        }
        onTransformEnd={(event) => {
          if (state.isSingleSelectionTransform) handlers.onObjectTransformEnd(object, event.target);
        }}
      />
    );
  }

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

function renderCorridorUnionItem(
  item: Extract<LevelRenderStackItem, { kind: 'corridorUnion' }>,
  corridorUnionGroups: CorridorUnionGroup[],
) {
  const group = corridorUnionGroups.find((entry) => entry.id === item.id);
  if (!group || group.objectIds.length < 2) return null;

  return (
    <Group key={`corridor-union-${group.id}`} listening={false}>
      {group.mergedPolygons.map((polygon, index) => (
        <Line
          key={`${group.id}-merged-${index}`}
          points={polygonToKonvaPoints(polygon)}
          closed
          fill={CORRIDOR_CANVAS_DEFAULT.fill}
          stroke={CORRIDOR_CANVAS_DEFAULT.stroke}
          strokeWidth={CORRIDOR_CANVAS_DEFAULT.strokeWidth}
          strokeScaleEnabled={false}
          dash={CORRIDOR_CANVAS_DEFAULT.dash}
          listening={false}
        />
      ))}
    </Group>
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
        if (item.kind === 'corridorUnion') {
          return renderCorridorUnionItem(item, state.corridorUnionGroups);
        }

        if (item.kind === 'seatGroup') {
          const group = state.levelSeatGroups.find((entry) => entry.id === item.id);
          if (!group) return null;
          const groupSeats = state.levelSeats.filter((seat) => seat.groupId === group.id);
          return (
            <SeatGroupNode
              key={group.id}
              group={group}
              groupSeats={groupSeats}
              selection={state.selection}
              zoom={state.zoom}
              placementToolActive={state.placementToolActive}
              readOnly={state.readOnly}
              tool={state.tool}
              containerRef={state.containerRef}
              getPointerPoint={state.getPointerPoint}
              onSelect={handlers.onSelect}
              onDragStart={handlers.onDragStart}
              onDragMove={handlers.onDragMove}
              onDragEnd={handlers.onDragEnd}
              onTransformEnd={handlers.onSeatGroupTransformEnd}
              onCommitPosition={(x, y) => handlers.onUpdateSeatGroupPosition(group.id, x, y)}
              onResizeStart={handlers.onSeatGroupResizeStart}
            />
          );
        }

        if (item.kind === 'seat') {
          const seat = state.levelSeats.find((entry) => entry.id === item.id);
          if (!seat) return null;
          return (
            <LooseSeatNode
              key={seat.id}
              seat={seat}
              selection={state.selection}
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
