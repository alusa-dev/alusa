import { useCallback, useRef, type RefObject } from 'react';

import { resolveSeatGroupGridResize } from '@alusa/domain';
import type { SeatGroupResizeStartState } from '../../components/SeatGroupResizeHandles';

export type SeatGroupResizeState = SeatGroupResizeStartState;

type UseSeatGroupResizeSessionOptions = {
  containerRef: RefObject<HTMLDivElement | null>;
  getPointerPoint: () => { x: number; y: number } | null;
  updateSeatGroup: (groupId: string, patch: { rows?: number; columns?: number }) => void;
};

export function useSeatGroupResizeSession({
  containerRef,
  getPointerPoint,
  updateSeatGroup,
}: UseSeatGroupResizeSessionOptions) {
  const seatGroupResizeRef = useRef<SeatGroupResizeState | null>(null);

  const beginSeatGroupResize = useCallback((state: SeatGroupResizeState) => {
    seatGroupResizeRef.current = state;
  }, []);

  const handleSeatGroupResizeMove = useCallback(() => {
    const seatResize = seatGroupResizeRef.current;
    if (!seatResize) return false;

    const pt = getPointerPoint();
    if (!pt) return true;

    const result = resolveSeatGroupGridResize({
      handle: seatResize.handle,
      startWorldPt: seatResize.startWorldPt,
      currentWorldPt: pt,
      startTotalW: seatResize.startTotalW,
      startTotalH: seatResize.startTotalH,
      paddingLeft: seatResize.paddingLeft,
      paddingRight: seatResize.paddingRight,
      paddingTop: seatResize.paddingTop,
      paddingBottom: seatResize.paddingBottom,
      gapX: seatResize.gapX,
      gapY: seatResize.gapY,
      stepX: seatResize.stepX,
      stepY: seatResize.stepY,
      lastCommittedRows: seatResize.lastCommittedRows,
      lastCommittedCols: seatResize.lastCommittedCols,
    });

    if (result.changed) {
      seatResize.lastCommittedRows = result.rows;
      seatResize.lastCommittedCols = result.columns;
      updateSeatGroup(seatResize.groupId, { rows: result.rows, columns: result.columns });
    }

    return true;
  }, [getPointerPoint, updateSeatGroup]);

  const endSeatGroupResize = useCallback(() => {
    if (!seatGroupResizeRef.current) return false;
    seatGroupResizeRef.current = null;
    if (containerRef.current) containerRef.current.style.cursor = '';
    return true;
  }, [containerRef]);

  return {
    beginSeatGroupResize,
    handleSeatGroupResizeMove,
    endSeatGroupResize,
  };
}
