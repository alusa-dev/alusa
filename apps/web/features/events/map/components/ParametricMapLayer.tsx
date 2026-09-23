import {
  isItemSelected,
  mapPointsLocalToWorld,
  pathToPolyline,
  rotatePoint,
  resolveSeatCountForRow,
  sectionLocalToWorld,
  type EventMapDocument,
  type MapSelection,
  type MapSelectionItem,
} from '@alusa/domain';
import { Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';

type ParametricMapLayerProps = {
  document: EventMapDocument | null | undefined;
  levelId: string;
  selection: MapSelection;
  readOnly: boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent>, item: MapSelectionItem) => void;
};

function handleSelect(
  event: Konva.KonvaEventObject<MouseEvent>,
  onSelect: ParametricMapLayerProps['onSelect'],
  item: MapSelectionItem,
) {
  event.cancelBubble = true;
  onSelect(event, item);
}

export function ParametricMapLayer({ document, levelId, selection, readOnly, onSelect }: ParametricMapLayerProps) {
  if (!document) return null;

  return (
    <>
      {document.sections
        .filter((section) => section.levelId === levelId && !section.hidden)
        .map((section) => {
          const hasSeatBlocks = section.blocks.length > 0;
          const outline = mapPointsLocalToWorld(section.outline, section.position, section.rotation).flatMap((point) => [point.x, point.y]);
          const sectionSelected = isItemSelected(selection, { type: 'section', id: section.id });
          return (
            <Group key={section.id} listening={!readOnly}>
              {!hasSeatBlocks && section.outline.length >= 3 ? (
                <Line
                  points={outline}
                  closed
                  fill={`${section.color}10`}
                  stroke={sectionSelected ? section.color : `${section.color}66`}
                  strokeWidth={sectionSelected ? 2 : 1}
                  dash={sectionSelected ? undefined : [8, 6]}
                  hitStrokeWidth={16}
                  onMouseDown={(event) => handleSelect(event, onSelect, { type: 'section', id: section.id })}
                />
              ) : null}
              {section.blocks.map((block) => {
                const blockSelected = isItemSelected(selection, { type: 'seatblock', id: block.id });
                const visibleRows = block.rows.filter((row, rowIndex) => resolveSeatCountForRow(block, row, rowIndex, block.rows.length) > 0);
                const renderTransformProxy = (rows: typeof visibleRows, id: string, selected: boolean, rotation: number) => {
                  if (!selected || rows.length === 0) return null;
                  const points = rows.flatMap((row) => pathToPolyline(row.path, row.path.type === 'ARC' ? 48 : 24).map((point) => sectionLocalToWorld(point, section.position, section.rotation)));
                  const padding = Math.max(...rows.map((row) => row.seatSize / 2), 8);
                  const localPoints = points.map((point) => rotatePoint(point, { x: 0, y: 0 }, -rotation));
                  const minX = Math.min(...localPoints.map((point) => point.x)) - padding;
                  const minY = Math.min(...localPoints.map((point) => point.y)) - padding;
                  const maxX = Math.max(...localPoints.map((point) => point.x)) + padding;
                  const maxY = Math.max(...localPoints.map((point) => point.y)) + padding;
                  const width = Math.max(1, maxX - minX);
                  const height = Math.max(1, maxY - minY);
                  const center = rotatePoint({ x: minX + width / 2, y: minY + height / 2 }, { x: 0, y: 0 }, rotation);
                  return <Rect key={`transform-${id}`} id={`node-${id}`} x={center.x} y={center.y} offsetX={width / 2} offsetY={height / 2} width={width} height={height} rotation={rotation} fill="rgba(0,0,0,0.001)" stroke="#7c3aed" strokeWidth={1} dash={[6, 4]} listening={false} />;
                };
                return <Group key={block.id} listening={!readOnly}>
                  {renderTransformProxy(visibleRows, `seatblock-${block.id}`, blockSelected, block.transformRotation ?? 0)}
                  {visibleRows.flatMap((row) => {
                  const rowSelected = isItemSelected(selection, { type: 'seatrow', id: row.id });
                  const points = mapPointsLocalToWorld(
                    pathToPolyline(row.path, row.path.type === 'ARC' ? 48 : 24),
                    section.position,
                    section.rotation,
                  ).flatMap((point) => [point.x, point.y]);
                  const first = points.length >= 2 ? { x: points[0], y: points[1] } : null;
                  return [(
                    <Group key={row.id} listening={!readOnly}>
                      {renderTransformProxy([row], `seatrow-${row.id}`, rowSelected, row.transformRotation ?? block.transformRotation ?? 0)}
                      <Line
                        id={`node-seatrow-line-${row.id}`}
                        points={points}
                        stroke={rowSelected || blockSelected ? section.color : `${section.color}44`}
                        strokeWidth={rowSelected ? 4 : 2}
                        dash={row.path.type === 'LINE' ? undefined : [5, 4]}
                        opacity={rowSelected || blockSelected ? 0.9 : 0.55}
                        hitStrokeWidth={18}
                        onMouseDown={(event) => handleSelect(event, onSelect, { type: 'seatblock', id: block.id })}
                        onDblClick={(event) => handleSelect(event, onSelect, { type: 'seatrow', id: row.id })}
                      />
                      {first ? (
                        <Text
                          id={`node-seatrow-label-${row.id}`}
                          x={first.x - 22}
                          y={first.y - 8}
                          text={row.label}
                          fontSize={10}
                          fontStyle={rowSelected ? 'bold' : 'normal'}
                          fill={rowSelected || blockSelected ? section.color : `${section.color}99`}
                          listening={false}
                        />
                      ) : null}
                    </Group>
                  )];
                })}</Group>;
              })}
            </Group>
          );
        })}
    </>
  );
}
