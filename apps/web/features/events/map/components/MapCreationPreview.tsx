import type { CreationDraft } from '../canvas/render/map-creation-draft';
import { getCreationBox, getCreationShape } from '../canvas/render/map-creation-draft';

import { Ellipse, Rect, RegularPolygon, Text } from 'react-konva';

export function MapCreationPreview({ creationDraft }: { creationDraft: CreationDraft | null }) {
  if (!creationDraft) return null;

  const box = getCreationBox(creationDraft);
  if (box.width < 2 || box.height < 2) return null;

  if (creationDraft.tool === 'text') {
    return (
      <>
        <Rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill="rgba(109, 40, 217, 0.06)"
          stroke="#6d28d9"
          strokeWidth={1.5}
          dash={[6, 4]}
          listening={false}
        />
        <Text
          x={box.x + 8}
          y={box.y + 8}
          text="Texto"
          fontSize={14}
          fill="#6d28d9"
          listening={false}
        />
      </>
    );
  }

  const shape = getCreationShape(creationDraft.tool);
  const stroke = '#6d28d9';
  const fill = 'rgba(109, 40, 217, 0.08)';

  if (shape === 'circle' || shape === 'ellipse') {
    return (
      <Ellipse
        x={box.x + box.width / 2}
        y={box.y + box.height / 2}
        radiusX={box.width / 2}
        radiusY={box.height / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        dash={[6, 4]}
        listening={false}
      />
    );
  }

  if (shape === 'triangle') {
    return (
      <RegularPolygon
        x={box.x + box.width / 2}
        y={box.y + box.height / 2}
        sides={3}
        radius={Math.min(box.width, box.height) / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        dash={[6, 4]}
        rotation={30}
        listening={false}
      />
    );
  }

  return (
    <Rect
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      fill={fill}
      stroke={stroke}
      strokeWidth={1.5}
      dash={[6, 4]}
      listening={false}
    />
  );
}
