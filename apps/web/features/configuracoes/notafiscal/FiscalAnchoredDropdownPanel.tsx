'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

const VIEWPORT_GAP = 8;
const PREFERRED_MAX_HEIGHT = 240;

type DropdownPlacement = 'bottom' | 'top';

type DropdownFrame = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: DropdownPlacement;
};

function computeDropdownFrame(anchor: HTMLElement): DropdownFrame {
  const rect = anchor.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_GAP;
  const spaceAbove = rect.top - VIEWPORT_GAP;
  const placement: DropdownPlacement = spaceBelow >= spaceAbove ? 'bottom' : 'top';
  const available = Math.max(placement === 'bottom' ? spaceBelow : spaceAbove, 80);
  const maxHeight = Math.min(PREFERRED_MAX_HEIGHT, available);

  if (placement === 'bottom') {
    return {
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight,
      placement,
    };
  }

  // Ancora pela base do painel para ficar colado acima do input, sem reservar maxHeight vazio.
  return {
    bottom: window.innerHeight - rect.top + 4,
    left: rect.left,
    width: rect.width,
    maxHeight,
    placement,
  };
}

export const FISCAL_DROPDOWN_PANEL_CLASS = cn(
  'overflow-y-scroll overscroll-contain rounded-lg border border-[#e5e7eb] bg-white p-1 shadow-lg',
  'pointer-events-auto [scrollbar-gutter:stable]',
  '[&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300',
);

type FiscalAnchoredDropdownPanelProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

function blockPointerFromReachingPage(event: ReactPointerEvent<HTMLDivElement>) {
  // Evita blur do input e cliques no campo abaixo ao usar a barra de rolagem (macOS overlay).
  event.preventDefault();
  event.stopPropagation();
}

export function FiscalAnchoredDropdownPanel({
  open,
  anchorRef,
  onClose,
  children,
  className,
}: FiscalAnchoredDropdownPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<DropdownFrame | null>(null);
  const [mounted, setMounted] = useState(false);

  const syncFrame = useCallback(() => {
    if (!anchorRef.current) return;
    setFrame(computeDropdownFrame(anchorRef.current));
  }, [anchorRef]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    syncFrame();
    window.addEventListener('resize', syncFrame);
    window.addEventListener('scroll', syncFrame, true);
    return () => {
      window.removeEventListener('resize', syncFrame);
      window.removeEventListener('scroll', syncFrame, true);
    };
  }, [open, syncFrame]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !mounted || !frame) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      className={cn(FISCAL_DROPDOWN_PANEL_CLASS, className)}
      style={{
        position: 'fixed',
        ...(frame.top !== undefined ? { top: frame.top } : { bottom: frame.bottom }),
        left: frame.left,
        width: frame.width,
        maxHeight: frame.maxHeight,
        zIndex: 200,
      }}
      onPointerDown={blockPointerFromReachingPage}
      onPointerDownCapture={blockPointerFromReachingPage}
    >
      {children}
    </div>,
    document.body,
  );
}
