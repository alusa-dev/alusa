import type { BoundingBox } from './snap-guides.js';

export const SPACING_GUIDE_COLOR = '#f43f5e';
const SPACING_REFERENCE_MARGIN = 1200;
const MAX_SPACING_REFERENCE_BOXES = 96;

export type SpacingGuideSegment = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  role: 'active' | 'reference';
};

export type SpacingGuideVisual = {
  type: 'spacing';
  orientation: 'H' | 'V';
  gap: number;
  segments: SpacingGuideSegment[];
};

type GapPair = {
  gap: number;
  first: BoundingBox;
  second: BoundingBox;
};

type AxisMatch = {
  diff: number;
  delta: number;
  guides: SpacingGuideVisual[];
};

function overlapSize(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
}

function sameRow(a: BoundingBox, b: BoundingBox) {
  return overlapSize(a.y, a.y + a.height, b.y, b.y + b.height) >= 4;
}

function sameColumn(a: BoundingBox, b: BoundingBox) {
  return overlapSize(a.x, a.x + a.width, b.x, b.x + b.width) >= 4;
}

function centerY(box: BoundingBox) {
  return box.y + box.height / 2;
}

function centerX(box: BoundingBox) {
  return box.x + box.width / 2;
}

function distanceToBox(a: BoundingBox, b: BoundingBox) {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
  return Math.hypot(dx, dy);
}

function collectRelevantSpacingBounds(draggedBox: BoundingBox, objectBounds: BoundingBox[]) {
  if (objectBounds.length <= MAX_SPACING_REFERENCE_BOXES) return objectBounds;

  const expanded = {
    x: draggedBox.x - SPACING_REFERENCE_MARGIN,
    y: draggedBox.y - SPACING_REFERENCE_MARGIN,
    width: draggedBox.width + SPACING_REFERENCE_MARGIN * 2,
    height: draggedBox.height + SPACING_REFERENCE_MARGIN * 2,
  };

  const nearby = objectBounds
    .filter((box) => overlapSize(expanded.x, expanded.x + expanded.width, box.x, box.x + box.width) > 0)
    .filter((box) => overlapSize(expanded.y, expanded.y + expanded.height, box.y, box.y + box.height) > 0);

  if (nearby.length <= MAX_SPACING_REFERENCE_BOXES) return nearby;

  return nearby
    .map((box) => ({ box, distance: distanceToBox(draggedBox, box) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_SPACING_REFERENCE_BOXES)
    .map((entry) => entry.box);
}

function collectHorizontalGapPairs(boxes: BoundingBox[]): GapPair[] {
  const pairs: GapPair[] = [];

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = 0; j < boxes.length; j += 1) {
      if (i === j) continue;
      const left = boxes[i];
      const right = boxes[j];
      if (!sameRow(left, right)) continue;
      if (left.x + left.width >= right.x) continue;

      const gap = right.x - (left.x + left.width);
      if (gap <= 0 || gap > 4000) continue;
      pairs.push({ gap, first: left, second: right });
    }
  }

  return pairs;
}

function collectVerticalGapPairs(boxes: BoundingBox[]): GapPair[] {
  const pairs: GapPair[] = [];

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = 0; j < boxes.length; j += 1) {
      if (i === j) continue;
      const top = boxes[i];
      const bottom = boxes[j];
      if (!sameColumn(top, bottom)) continue;
      if (top.y + top.height >= bottom.y) continue;

      const gap = bottom.y - (top.y + top.height);
      if (gap <= 0 || gap > 4000) continue;
      pairs.push({ gap, first: top, second: bottom });
    }
  }

  return pairs;
}

function buildHorizontalSpacingGuide(
  gap: number,
  leftEdge: number,
  rightEdge: number,
  rowBoxes: BoundingBox[],
  reference?: GapPair,
): SpacingGuideVisual {
  const y = rowBoxes.reduce((value, box) => value + centerY(box), 0) / rowBoxes.length;
  const segments: SpacingGuideSegment[] = [
    {
      start: { x: leftEdge, y },
      end: { x: rightEdge, y },
      role: 'active',
    },
  ];

  if (reference) {
    const refY = centerY(reference.first);
    segments.push({
      start: { x: reference.first.x + reference.first.width, y: refY },
      end: { x: reference.second.x, y: refY },
      role: 'reference',
    });
  }

  return {
    type: 'spacing',
    orientation: 'H',
    gap,
    segments,
  };
}

function buildVerticalSpacingGuide(
  gap: number,
  topEdge: number,
  bottomEdge: number,
  columnBoxes: BoundingBox[],
  reference?: GapPair,
): SpacingGuideVisual {
  const x = columnBoxes.reduce((value, box) => value + centerX(box), 0) / columnBoxes.length;
  const segments: SpacingGuideSegment[] = [
    {
      start: { x, y: topEdge },
      end: { x, y: bottomEdge },
      role: 'active',
    },
  ];

  if (reference) {
    const refX = centerX(reference.first);
    segments.push({
      start: { x: refX, y: reference.first.y + reference.first.height },
      end: { x: refX, y: reference.second.y },
      role: 'reference',
    });
  }

  return {
    type: 'spacing',
    orientation: 'V',
    gap,
    segments,
  };
}

function findBestHorizontalMatch(
  draggedBox: BoundingBox,
  objectBounds: BoundingBox[],
  gapRefs: GapPair[],
  threshold: number,
): AxisMatch {
  let best: AxisMatch = { diff: threshold, delta: 0, guides: [] };

  for (const ref of gapRefs) {
    for (const neighbor of objectBounds) {
      if (!sameRow(draggedBox, neighbor)) continue;

      const targetRight = neighbor.x + neighbor.width + ref.gap;
      const diffRight = Math.abs(draggedBox.x - targetRight);
      if (diffRight < best.diff && draggedBox.x + draggedBox.width > neighbor.x + neighbor.width - threshold) {
        const snappedBox = { ...draggedBox, x: targetRight };
        best = {
          diff: diffRight,
          delta: targetRight - draggedBox.x,
          guides: [
            buildHorizontalSpacingGuide(
              ref.gap,
              neighbor.x + neighbor.width,
              targetRight,
              [neighbor, snappedBox],
              ref,
            ),
          ],
        };
      }

      const targetLeft = neighbor.x - ref.gap - draggedBox.width;
      const diffLeft = Math.abs(draggedBox.x - targetLeft);
      if (diffLeft < best.diff && draggedBox.x + draggedBox.width < neighbor.x + threshold) {
        const snappedBox = { ...draggedBox, x: targetLeft };
        best = {
          diff: diffLeft,
          delta: targetLeft - draggedBox.x,
          guides: [
            buildHorizontalSpacingGuide(
              ref.gap,
              targetLeft + draggedBox.width,
              neighbor.x,
              [snappedBox, neighbor],
              ref,
            ),
          ],
        };
      }
    }
  }

  for (const left of objectBounds) {
    for (const right of objectBounds) {
      if (left === right) continue;
      if (left.x + left.width >= right.x - 1) continue;
      if (!sameRow(left, right) || !sameRow(left, draggedBox) || !sameRow(right, draggedBox)) continue;

      const targetX = (left.x + left.width + right.x - draggedBox.width) / 2;
      const diff = Math.abs(draggedBox.x - targetX);
      if (diff >= best.diff) continue;
      if (draggedBox.x + draggedBox.width > right.x + threshold) continue;
      if (draggedBox.x < left.x + left.width - threshold) continue;

      const gap = (right.x - (left.x + left.width) - draggedBox.width) / 2;
      const snappedBox = { ...draggedBox, x: targetX };
      best = {
        diff,
        delta: targetX - draggedBox.x,
        guides: [
          buildHorizontalSpacingGuide(gap, left.x + left.width, targetX, [left, snappedBox]),
          buildHorizontalSpacingGuide(gap, targetX + draggedBox.width, right.x, [snappedBox, right]),
        ],
      };
    }
  }

  return best;
}

function findBestVerticalMatch(
  draggedBox: BoundingBox,
  objectBounds: BoundingBox[],
  gapRefs: GapPair[],
  threshold: number,
): AxisMatch {
  let best: AxisMatch = { diff: threshold, delta: 0, guides: [] };

  for (const ref of gapRefs) {
    for (const neighbor of objectBounds) {
      if (!sameColumn(draggedBox, neighbor)) continue;

      const targetBottom = neighbor.y + neighbor.height + ref.gap;
      const diffBottom = Math.abs(draggedBox.y - targetBottom);
      if (diffBottom < best.diff && draggedBox.y + draggedBox.height > neighbor.y + neighbor.height - threshold) {
        const snappedBox = { ...draggedBox, y: targetBottom };
        best = {
          diff: diffBottom,
          delta: targetBottom - draggedBox.y,
          guides: [
            buildVerticalSpacingGuide(
              ref.gap,
              neighbor.y + neighbor.height,
              targetBottom,
              [neighbor, snappedBox],
              ref,
            ),
          ],
        };
      }

      const targetTop = neighbor.y - ref.gap - draggedBox.height;
      const diffTop = Math.abs(draggedBox.y - targetTop);
      if (diffTop < best.diff && draggedBox.y + draggedBox.height < neighbor.y + threshold) {
        const snappedBox = { ...draggedBox, y: targetTop };
        best = {
          diff: diffTop,
          delta: targetTop - draggedBox.y,
          guides: [
            buildVerticalSpacingGuide(
              ref.gap,
              targetTop + draggedBox.height,
              neighbor.y,
              [snappedBox, neighbor],
              ref,
            ),
          ],
        };
      }
    }
  }

  for (const top of objectBounds) {
    for (const bottom of objectBounds) {
      if (top === bottom) continue;
      if (top.y + top.height >= bottom.y - 1) continue;
      if (!sameColumn(top, bottom) || !sameColumn(top, draggedBox) || !sameColumn(bottom, draggedBox)) continue;

      const targetY = (top.y + top.height + bottom.y - draggedBox.height) / 2;
      const diff = Math.abs(draggedBox.y - targetY);
      if (diff >= best.diff) continue;
      if (draggedBox.y + draggedBox.height > bottom.y + threshold) continue;
      if (draggedBox.y < top.y + top.height - threshold) continue;

      const gap = (bottom.y - (top.y + top.height) - draggedBox.height) / 2;
      const snappedBox = { ...draggedBox, y: targetY };
      best = {
        diff,
        delta: targetY - draggedBox.y,
        guides: [
          buildVerticalSpacingGuide(gap, top.y + top.height, targetY, [top, snappedBox]),
          buildVerticalSpacingGuide(gap, targetY + draggedBox.height, bottom.y, [snappedBox, bottom]),
        ],
      };
    }
  }

  return best;
}

export function findSpacingSnaps(
  draggedBox: BoundingBox,
  objectBounds: BoundingBox[],
  threshold: number,
): { deltaX: number; deltaY: number; diffX: number; diffY: number; guides: SpacingGuideVisual[] } {
  if (objectBounds.length === 0) {
    return { deltaX: 0, deltaY: 0, diffX: Number.POSITIVE_INFINITY, diffY: Number.POSITIVE_INFINITY, guides: [] };
  }

  const relevantBounds = collectRelevantSpacingBounds(draggedBox, objectBounds);
  const horizontal = findBestHorizontalMatch(draggedBox, relevantBounds, collectHorizontalGapPairs(relevantBounds), threshold);
  const vertical = findBestVerticalMatch(draggedBox, relevantBounds, collectVerticalGapPairs(relevantBounds), threshold);

  return {
    deltaX: horizontal.delta,
    deltaY: vertical.delta,
    diffX: horizontal.guides.length > 0 ? horizontal.diff : Number.POSITIVE_INFINITY,
    diffY: vertical.guides.length > 0 ? vertical.diff : Number.POSITIVE_INFINITY,
    guides: [...horizontal.guides, ...vertical.guides],
  };
}

export function mergeSnapDeltas(
  edgeDelta: { x: number; y: number },
  spacingDelta: { x: number; y: number },
  edgeDiff: { x: number; y: number },
  spacingDiff: { x: number; y: number },
) {
  const spacingWinsX = Number.isFinite(spacingDiff.x) && spacingDiff.x <= edgeDiff.x;
  const spacingWinsY = Number.isFinite(spacingDiff.y) && spacingDiff.y <= edgeDiff.y;

  return {
    x: spacingWinsX ? spacingDelta.x : edgeDelta.x,
    y: spacingWinsY ? spacingDelta.y : edgeDelta.y,
  };
}
