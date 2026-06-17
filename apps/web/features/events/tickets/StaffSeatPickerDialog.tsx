'use client';

import type { StaffEventMapSalesViewDTO } from '@alusa/lib/events/map/staff-map-sales.service';
import { getSeatGroupSeatWorldCenter, MAP_ARTBOARD_STROKE, MAP_ARTBOARD_STROKE_WIDTH } from '@alusa/domain';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { PublicMapLevelTabs } from '../map/public/PublicMapLevelTabs';
import { PublicMapTextSvg } from '../map/public/public-map-text-render';
import { PublicMapViewport } from '../map/public/PublicMapViewport';
import {
  filterPublicMapRenderableObjects,
  filterPublicMapSeatsByLevel,
  getDefaultPublicMapLevelId,
  getPublicMapLevelById,
  resolvePublicMapLevels,
  type PublicMapLevelView,
} from '../map/public/public-map-level-view';
import { publicSeatTooltip } from '../map/public/public-order-utils';
import {
  getStaffEventMapSalesView,
  reserveStaffSeats,
  type StaffSeatReservationResult,
} from '../events-service';

type StaffSeat = StaffEventMapSalesViewDTO['seats'][number];
type StaffSeatGroup = NonNullable<StaffEventMapSalesViewDTO['seatGroups']>[number];
type StaffObject = {
  id: string;
  levelId?: string | null;
  sectionId?: string | null;
  type: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  hidden?: boolean;
  data?: Record<string, unknown>;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function objectStyle(object: StaffObject) {
  const data = object.data ?? {};
  if (object.type === 'CORRIDOR') return { fill: '#ede9fe', stroke: '#8b5cf6', dash: '7 5' };
  if (object.type === 'STAGE') return { fill: '#111827', stroke: '#111827', dash: undefined };
  if (object.type === 'BLOCKED_AREA') return { fill: '#fee2e2', stroke: '#ef4444', dash: '7 5' };
  if (object.type === 'TEXT') return { fill: 'transparent', stroke: 'transparent', dash: undefined };
  if (object.type === 'SECTION') {
    const fillEnabled = data.fillEnabled === true;
    return {
      fill: fillEnabled && typeof data.fill === 'string' ? data.fill : 'transparent',
      stroke: fillEnabled ? '#7c3aed' : 'transparent',
      dash: undefined,
    };
  }
  return { fill: '#f8fafc', stroke: '#cbd5e1', dash: undefined };
}

function staffSeatClasses(seat: StaffSeat, selected: boolean, ownHeldIds: Set<string>) {
  if (selected) return 'fill-brand-accent stroke-brand-accent';
  if (seat.status === 'AVAILABLE') return 'fill-emerald-500 stroke-emerald-700 cursor-pointer';
  if (seat.status === 'HELD' && ownHeldIds.has(seat.id)) return 'fill-amber-300 stroke-amber-600 cursor-pointer';
  if (seat.status === 'HELD') return 'fill-amber-400 stroke-amber-700 cursor-not-allowed';
  if (seat.status === 'SOLD') return 'fill-slate-300 stroke-slate-400 cursor-not-allowed';
  if (seat.status === 'BLOCKED') return 'fill-rose-200 stroke-rose-400 cursor-not-allowed';
  return 'fill-slate-200 stroke-slate-300 cursor-not-allowed';
}

function isSeatSelectable(seat: StaffSeat, selectedIds: string[], ownHeldIds: Set<string>) {
  if (seat.status === 'AVAILABLE') return true;
  if (seat.status === 'HELD' && (ownHeldIds.has(seat.id) || selectedIds.includes(seat.id))) return true;
  return false;
}

export function StaffSeatPickerDialog({
  open,
  onOpenChange,
  eventId,
  mapId,
  initialHoldToken,
  initialSeatIds,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  mapId: string;
  initialHoldToken?: string | null;
  initialSeatIds?: string[];
  onConfirm: (result: StaffSeatReservationResult) => void;
}) {
  const [map, setMap] = useState<StaffEventMapSalesViewDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSeatIds ?? []);
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(initialSeatIds ?? []);
    setError(null);
    setLoading(true);
    getStaffEventMapSalesView(eventId, mapId)
      .then((data) => {
        setMap(data);
        const levels = resolvePublicMapLevels(data.levels as PublicMapLevelView[]);
        setActiveLevelId(getDefaultPublicMapLevelId(levels));
      })
      .catch((loadError) => setError((loadError as Error).message))
      .finally(() => setLoading(false));
  }, [open, eventId, mapId, initialSeatIds]);

  const panelLevels = useMemo(
    () => resolvePublicMapLevels((map?.levels ?? []) as PublicMapLevelView[]),
    [map?.levels],
  );
  const activeLevel = useMemo(
    () => (activeLevelId ? getPublicMapLevelById(panelLevels, activeLevelId) : null),
    [activeLevelId, panelLevels],
  );
  const levelObjects = useMemo(() => {
    if (!map || !activeLevel) return [];
    return filterPublicMapRenderableObjects(
      { seatGroups: map.seatGroups, seats: map.seats },
      map.objects as StaffObject[],
      activeLevel.id,
    );
  }, [activeLevel, map]);
  const levelSeats = useMemo(() => {
    if (!map || !activeLevel) return [];
    return filterPublicMapSeatsByLevel(map.seats, activeLevel.id);
  }, [activeLevel, map]);
  const seatGroupById = useMemo(
    () => new Map((map?.seatGroups ?? []).map((group) => [group.id, group as StaffSeatGroup])),
    [map?.seatGroups],
  );
  const ownHeldIds = useMemo(() => new Set(initialSeatIds ?? []), [initialSeatIds]);
  const selectedSeats = useMemo(
    () => (map?.seats ?? []).filter((seat) => selectedIds.includes(seat.id)),
    [map?.seats, selectedIds],
  );
  const total = selectedSeats.reduce((sum, seat) => sum + seat.unitPrice, 0);

  function toggleSeat(seat: StaffSeat) {
    if (!isSeatSelectable(seat, selectedIds, ownHeldIds)) return;
    setSelectedIds((current) => {
      if (current.includes(seat.id)) {
        if (initialSeatIds?.includes(seat.id)) return current;
        return current.filter((seatId) => seatId !== seat.id);
      }
      return [...current, seat.id];
    });
    setError(null);
  }

  async function handleConfirm() {
    if (selectedIds.length === 0) {
      setError('Selecione pelo menos um assento.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await reserveStaffSeats(eventId, mapId, {
        seatIds: selectedIds,
        holdToken: initialHoldToken ?? undefined,
      });
      onConfirm(result);
      onOpenChange(false);
    } catch (confirmError) {
      setError((confirmError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="alusa-modal-surface flex h-[min(92vh,900px)] max-w-[min(96vw,1200px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-slate-200 px-5 py-4">
          <DialogTitle>Escolher assentos</DialogTitle>
          <DialogDescription>
            Clique nos assentos disponíveis para adicionar. Para remover assentos já escolhidos, use o X no formulário.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
          {map ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <PublicMapLevelTabs levels={panelLevels} activeLevelId={activeLevel?.id ?? ''} onLevelChange={setActiveLevelId} />
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-emerald-500" /> Disponível</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-400" /> Reservado</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-slate-300" /> Vendido</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-brand-accent" /> Selecionado</span>
                </div>
              </div>

              {activeLevel ? (
                <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 [&>div]:!h-full [&>div]:min-h-[360px]">
                  <PublicMapViewport
                    artboardWidth={activeLevel.widthPx}
                    artboardHeight={activeLevel.heightPx}
                    levelId={activeLevel.id}
                    ariaLabel={`Mapa operacional — ${activeLevel.name}`}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={activeLevel.widthPx}
                      height={activeLevel.heightPx}
                      fill="#fff"
                      stroke={MAP_ARTBOARD_STROKE}
                      strokeWidth={MAP_ARTBOARD_STROKE_WIDTH}
                    />
                    {levelObjects.map((object) => {
                      const style = objectStyle(object);
                      const width = object.width ?? 0;
                      const height = object.height ?? 0;
                      const cx = object.x + width / 2;
                      const cy = object.y + height / 2;
                      if (object.type === 'TEXT') {
                        return <PublicMapTextSvg key={object.id} object={object as import('../map/public/public-map-text-render').PublicMapTextObject} />;
                      }
                      return (
                        <rect
                          key={object.id}
                          x={object.x}
                          y={object.y}
                          width={width}
                          height={height}
                          rx={object.type === 'CORRIDOR' ? 0 : 6}
                          fill={style.fill}
                          stroke={style.stroke}
                          strokeWidth={object.type === 'CORRIDOR' ? 2 : 1.5}
                          strokeDasharray={style.dash}
                          transform={`rotate(${object.rotation} ${cx} ${cy})`}
                        />
                      );
                    })}
                    {levelSeats.map((seat) => {
                      const selected = selectedIds.includes(seat.id);
                      const group = seat.groupId ? seatGroupById.get(seat.groupId) : null;
                      const center = group ? getSeatGroupSeatWorldCenter(group, seat) : { x: seat.x, y: seat.y };
                      const rotation = group ? group.rotation : seat.rotation;
                      const radius = Math.max((group?.seatWidth ?? seat.size ?? 28) / 2, 8);
                      const interactive = isSeatSelectable(seat, selectedIds, ownHeldIds);
                      return (
                        <g key={seat.id} transform={`rotate(${rotation} ${center.x} ${center.y})`}>
                          <title>{publicSeatTooltip(seat.status, seat.displayLabel, seat.sectionName)}</title>
                          <circle
                            data-public-seat
                            cx={center.x}
                            cy={center.y}
                            r={radius}
                            strokeWidth={selected ? 4 : 2}
                            className={staffSeatClasses(seat, selected, ownHeldIds)}
                            onClick={() => (interactive ? toggleSeat(seat) : undefined)}
                          />
                          <text
                            x={center.x}
                            y={center.y + 4}
                            textAnchor="middle"
                            className="pointer-events-none select-none fill-white text-[12px] font-semibold"
                          >
                            {seat.displayLabel}
                          </text>
                        </g>
                      );
                    })}
                  </PublicMapViewport>
                </div>
              ) : null}
            </>
          ) : null}

          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando mapa...
            </div>
          ) : null}

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>

        <DialogFooter className="border-t border-slate-200 px-5 py-4 sm:justify-between">
          <div className="text-sm text-slate-600">
            <strong>{selectedSeats.length}</strong> assento(s) · <strong>{formatCurrency(total)}</strong>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={submitting || loading || selectedIds.length === 0}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar assentos
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
