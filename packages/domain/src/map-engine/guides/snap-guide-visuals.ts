import type { SnapGuideLine } from './snap-guides.js';
import type { SpacingGuideVisual } from './spacing-guides.js';

const GUIDE_EPSILON = 0.01;

export type SpacingGuideMatch = {
  guides: SpacingGuideVisual[];
  diffX: number;
  diffY: number;
};

export type ActiveGuideVisuals = {
  guides: SnapGuideLine[];
  spacingGuides: SpacingGuideVisual[];
};

/** Keeps guides visible while a match is within threshold, including when delta is already 0. */
export function resolveActiveGuideVisuals(
  guides: SnapGuideLine[],
  spacing: SpacingGuideMatch,
  edgeDiffX: number,
  edgeDiffY: number,
  threshold: number,
): ActiveGuideVisuals {
  const spacingWinsX = spacing.guides.some((guide) => guide.orientation === 'H') && spacing.diffX <= edgeDiffX;
  const spacingWinsY = spacing.guides.some((guide) => guide.orientation === 'V') && spacing.diffY <= edgeDiffY;

  return {
    spacingGuides: [
      ...(spacingWinsX && spacing.diffX <= threshold ? spacing.guides.filter((guide) => guide.orientation === 'H') : []),
      ...(spacingWinsY && spacing.diffY <= threshold ? spacing.guides.filter((guide) => guide.orientation === 'V') : []),
    ],
    guides: guides.filter((guide) => {
      if (guide.orientation === 'V') return edgeDiffX <= threshold && !spacingWinsX;
      return edgeDiffY <= threshold && !spacingWinsY;
    }),
  };
}

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) < GUIDE_EPSILON && Math.abs(a.y - b.y) < GUIDE_EPSILON;
}

function sameGuideValue(a: number, b: number) {
  return Math.abs(a - b) < GUIDE_EPSILON;
}

export function areActiveGuideVisualsEqual(a: ActiveGuideVisuals, b: ActiveGuideVisuals) {
  if (a.guides.length !== b.guides.length || a.spacingGuides.length !== b.spacingGuides.length) {
    return false;
  }

  for (let index = 0; index < a.guides.length; index += 1) {
    const left = a.guides[index];
    const right = b.guides[index];
    if (!left || !right) return false;
    if (
      !sameGuideValue(left.lineGuide, right.lineGuide) ||
      left.orientation !== right.orientation ||
      left.snap !== right.snap ||
      left.source !== right.source ||
      !sameGuideValue(left.offset, right.offset) ||
      !sameGuideValue(left.span.start, right.span.start) ||
      !sameGuideValue(left.span.end, right.span.end)
    ) {
      return false;
    }
  }

  for (let index = 0; index < a.spacingGuides.length; index += 1) {
    const left = a.spacingGuides[index];
    const right = b.spacingGuides[index];
    if (!left || !right) return false;
    if (left.orientation !== right.orientation || left.gap !== right.gap || left.segments.length !== right.segments.length) {
      return false;
    }

    for (let segmentIndex = 0; segmentIndex < left.segments.length; segmentIndex += 1) {
      const leftSegment = left.segments[segmentIndex];
      const rightSegment = right.segments[segmentIndex];
      if (!leftSegment || !rightSegment) return false;
      if (
        leftSegment.role !== rightSegment.role ||
        !samePoint(leftSegment.start, rightSegment.start) ||
        !samePoint(leftSegment.end, rightSegment.end)
      ) {
        return false;
      }
    }
  }

  return true;
}
