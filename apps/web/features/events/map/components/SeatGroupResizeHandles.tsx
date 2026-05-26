import type { RefObject } from 'react';

import Konva from 'konva';
import { Rect } from 'react-konva';

export type SeatGroupResizeHandle = 'right' | 'bottom' | 'bottom-right';

export type SeatGroupResizeStartState = {
  groupId: string;
  handle: SeatGroupResizeHandle;
  startWorldPt: { x: number; y: number };
  startRows: number;
  startColumns: number;
  startTotalW: number;
  startTotalH: number;
  stepX: number;
  stepY: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  gapX: number;
  gapY: number;
  lastCommittedRows: number;
  lastCommittedCols: number;
};

type SeatGroupResizeHandlesProps = {
  zoom: number;
  totalX: number;
  totalY: number;
  totalW: number;
  totalH: number;
  groupId: string;
  groupRows: number;
  groupColumns: number;
  stepX: number;
  stepY: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  gapX: number;
  gapY: number;
  containerRef: RefObject<HTMLDivElement | null>;
  getPointerPoint: () => { x: number; y: number } | null;
  onResizeStart: (state: SeatGroupResizeStartState) => void;
};

function buildResizeStartState(
  props: SeatGroupResizeHandlesProps,
  handle: SeatGroupResizeHandle,
  pt: { x: number; y: number },
): SeatGroupResizeStartState {
  return {
    groupId: props.groupId,
    handle,
    startWorldPt: pt,
    startRows: props.groupRows,
    startColumns: props.groupColumns,
    startTotalW: props.totalW,
    startTotalH: props.totalH,
    stepX: props.stepX,
    stepY: props.stepY,
    paddingLeft: props.paddingLeft,
    paddingRight: props.paddingRight,
    paddingTop: props.paddingTop,
    paddingBottom: props.paddingBottom,
    gapX: props.gapX,
    gapY: props.gapY,
    lastCommittedRows: props.groupRows,
    lastCommittedCols: props.groupColumns,
  };
}

export function SeatGroupResizeHandles(props: SeatGroupResizeHandlesProps) {
  const {
    zoom,
    totalX,
    totalY,
    totalW,
    totalH,
    containerRef,
    getPointerPoint,
    onResizeStart,
  } = props;

  const handleSize = 10 / zoom;
  const halfHandle = 5 / zoom;

  const beginResize = (event: Konva.KonvaEventObject<MouseEvent>, handle: SeatGroupResizeHandle) => {
    event.cancelBubble = true;
    const pt = getPointerPoint();
    if (!pt) return;
    onResizeStart(buildResizeStartState(props, handle, pt));
  };

  return (
    <>
      <Rect
        x={totalX + totalW - halfHandle}
        y={totalY + totalH / 2 - halfHandle}
        width={handleSize}
        height={handleSize}
        fill="white"
        stroke="#2563eb"
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        cornerRadius={2}
        hitStrokeWidth={6}
        onMouseEnter={() => {
          if (containerRef.current) containerRef.current.style.cursor = 'ew-resize';
        }}
        onMouseLeave={() => {
          if (containerRef.current) containerRef.current.style.cursor = '';
        }}
        onMouseDown={(event) => beginResize(event, 'right')}
      />
      <Rect
        x={totalX + totalW / 2 - halfHandle}
        y={totalY + totalH - halfHandle}
        width={handleSize}
        height={handleSize}
        fill="white"
        stroke="#2563eb"
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        cornerRadius={2}
        hitStrokeWidth={6}
        onMouseEnter={() => {
          if (containerRef.current) containerRef.current.style.cursor = 'ns-resize';
        }}
        onMouseLeave={() => {
          if (containerRef.current) containerRef.current.style.cursor = '';
        }}
        onMouseDown={(event) => beginResize(event, 'bottom')}
      />
      <Rect
        x={totalX + totalW - halfHandle}
        y={totalY + totalH - halfHandle}
        width={handleSize}
        height={handleSize}
        fill="white"
        stroke="#2563eb"
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        cornerRadius={2}
        hitStrokeWidth={6}
        onMouseEnter={() => {
          if (containerRef.current) containerRef.current.style.cursor = 'nwse-resize';
        }}
        onMouseLeave={() => {
          if (containerRef.current) containerRef.current.style.cursor = '';
        }}
        onMouseDown={(event) => beginResize(event, 'bottom-right')}
      />
    </>
  );
}
