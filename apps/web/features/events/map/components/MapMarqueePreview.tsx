import { normalizeBoundsRect } from '@alusa/domain';

import type { MarqueeDraft } from '../canvas/render/map-creation-draft';

import { Rect } from 'react-konva';

export function MapMarqueePreview({ marqueeDraft }: { marqueeDraft: MarqueeDraft | null }) {
  if (!marqueeDraft) return null;

  const box = normalizeBoundsRect(marqueeDraft.start, marqueeDraft.current);
  if (box.width < 2 && box.height < 2) return null;

  return (
    <Rect
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      fill="rgba(37, 99, 235, 0.08)"
      stroke="#2563eb"
      strokeWidth={1}
      dash={[4, 4]}
      listening={false}
    />
  );
}
