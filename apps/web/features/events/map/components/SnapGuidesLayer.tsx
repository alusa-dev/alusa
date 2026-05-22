'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Group, Line } from 'react-konva';

import { areActiveGuideVisualsEqual, type ActiveGuideVisuals } from '../lib/snap-guide-visuals';
import { SNAP_GUIDE_COLOR, type SnapGuideLine } from '../lib/snap-guides';
import { SPACING_GUIDE_COLOR, type SpacingGuideVisual } from '../lib/spacing-guides';

export type SnapGuidesLayerHandle = {
  setGuides: (guides: SnapGuideLine[], spacingGuides: SpacingGuideVisual[]) => void;
  clearGuides: () => void;
};

type SnapGuidesLayerProps = {
  zoom: number;
};

function getStrokeWidth(zoom: number) {
  return Math.max(1 / zoom, 0.75);
}

export const SnapGuidesLayer = forwardRef<SnapGuidesLayerHandle, SnapGuidesLayerProps>(function SnapGuidesLayer(
  { zoom },
  ref,
) {
  const [visuals, setVisuals] = useState<ActiveGuideVisuals>({ guides: [], spacingGuides: [] });
  const lastVisualsRef = useRef<ActiveGuideVisuals>({ guides: [], spacingGuides: [] });

  useImperativeHandle(
    ref,
    () => ({
      setGuides(nextGuides, nextSpacingGuides) {
        const nextVisuals = { guides: nextGuides, spacingGuides: nextSpacingGuides };
        if (areActiveGuideVisualsEqual(lastVisualsRef.current, nextVisuals)) return;
        lastVisualsRef.current = nextVisuals;
        setVisuals(nextVisuals);
      },
      clearGuides() {
        const empty = { guides: [], spacingGuides: [] };
        if (areActiveGuideVisualsEqual(lastVisualsRef.current, empty)) return;
        lastVisualsRef.current = empty;
        setVisuals(empty);
      },
    }),
    [],
  );

  const { guides, spacingGuides } = visuals;
  if (!guides.length && !spacingGuides.length) return null;

  const strokeWidth = getStrokeWidth(zoom);
  const tickSize = Math.max(5 / zoom, 3);
  const spacingCap = Math.max(4 / zoom, 2.5);

  return (
    <>
      {guides.map((guide, index) => {
        const points =
          guide.orientation === 'V'
            ? [guide.lineGuide, guide.span.start, guide.lineGuide, guide.span.end]
            : [guide.span.start, guide.lineGuide, guide.span.end, guide.lineGuide];

        const tickPoints =
          guide.source === 'object'
            ? guide.orientation === 'V'
              ? [
                  [guide.lineGuide - tickSize, guide.span.start, guide.lineGuide + tickSize, guide.span.start],
                  [guide.lineGuide - tickSize, guide.span.end, guide.lineGuide + tickSize, guide.span.end],
                ]
              : [
                  [guide.span.start, guide.lineGuide - tickSize, guide.span.start, guide.lineGuide + tickSize],
                  [guide.span.end, guide.lineGuide - tickSize, guide.span.end, guide.lineGuide + tickSize],
                ]
            : [];

        return (
          <Group key={`snap-${guide.orientation}-${guide.lineGuide}-${index}`} listening={false}>
            <Line
              points={points}
              stroke={SNAP_GUIDE_COLOR}
              strokeWidth={strokeWidth}
              strokeScaleEnabled={false}
              dash={guide.source === 'page' ? [6, 4] : undefined}
              listening={false}
              perfectDrawEnabled={false}
              lineCap="round"
            />
            {tickPoints.map((tick, tickIndex) => (
              <Line
                key={`tick-${tickIndex}`}
                points={tick}
                stroke={SNAP_GUIDE_COLOR}
                strokeWidth={strokeWidth}
                strokeScaleEnabled={false}
                listening={false}
                perfectDrawEnabled={false}
                lineCap="round"
              />
            ))}
          </Group>
        );
      })}

      {spacingGuides.map((guide, index) => (
        <Group key={`spacing-${guide.orientation}-${guide.gap}-${index}`} listening={false}>
          {guide.segments.map((segment, segmentIndex) => {
            const points = [segment.start.x, segment.start.y, segment.end.x, segment.end.y];
            const isHorizontal = guide.orientation === 'H';
            const capPoints = isHorizontal
              ? [
                  [segment.start.x, segment.start.y - spacingCap, segment.start.x, segment.start.y + spacingCap],
                  [segment.end.x, segment.end.y - spacingCap, segment.end.x, segment.end.y + spacingCap],
                ]
              : [
                  [segment.start.x - spacingCap, segment.start.y, segment.start.x + spacingCap, segment.start.y],
                  [segment.end.x - spacingCap, segment.end.y, segment.end.x + spacingCap, segment.end.y],
                ];

            return (
              <Group key={`spacing-segment-${segmentIndex}`} listening={false}>
                <Line
                  points={points}
                  stroke={SPACING_GUIDE_COLOR}
                  strokeWidth={strokeWidth}
                  strokeScaleEnabled={false}
                  dash={segment.role === 'reference' ? [5, 4] : undefined}
                  listening={false}
                  perfectDrawEnabled={false}
                  lineCap="round"
                />
                {segment.role === 'active'
                  ? capPoints.map((cap, capIndex) => (
                      <Line
                        key={`spacing-cap-${capIndex}`}
                        points={cap}
                        stroke={SPACING_GUIDE_COLOR}
                        strokeWidth={strokeWidth}
                        strokeScaleEnabled={false}
                        listening={false}
                        perfectDrawEnabled={false}
                        lineCap="round"
                      />
                    ))
                  : null}
              </Group>
            );
          })}
        </Group>
      ))}
    </>
  );
});
