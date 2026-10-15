'use client';

import type { StaffEventMapSalesViewDTO } from '@alusa/lib/events/map/staff-map-sales.service';
import {
  MAP_ARTBOARD_STROKE,
  MAP_ARTBOARD_STROKE_WIDTH,
  type EventMapObjectDTO,
  type EventMapDocument,
} from '@alusa/domain';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { PublicMapViewport } from '../map/public/PublicMapViewport';
import { PublicMapSceneRenderer, buildPublicMapSceneItems } from '../map/public/public-map-scene-render';
import {
  filterPublicMapRenderableObjects,
  filterPublicMapSeatsByLevel,
  getDefaultPublicMapLevelId,
  getPublicMapLevelById,
  resolvePublicMapLevels,
  type PublicMapLevelView,
} from '../map/public/public-map-level-view';
import {
  getStaffEventMapSalesView,
  reserveStaffSeats,
  type StaffSeatReservationResult,
} from '../events-service';

type StaffSeat = StaffEventMapSalesViewDTO['seats'][number];
type StaffObject = EventMapObjectDTO;

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function isSeatSelectable(seat: { id: string; status: string; isOwnHold?: boolean }, _selectedIds: string[], _ownHeldIds: Set<string>) {
  if (seat.status === 'AVAILABLE') return true;
  if (seat.status === 'HELD' && seat.isOwnHold === true) return true;
  return false;
}

export function toggleStaffSeatSelection<T extends { id: string; status: string; isOwnHold?: boolean }>(
  seat: T,
  selectedIds: string[],
  _ownHeldIds: Set<string>,
) {
  if (selectedIds.includes(seat.id)) return selectedIds.filter((seatId) => seatId !== seat.id);
  if (!isSeatSelectable(seat, selectedIds, _ownHeldIds)) return selectedIds;
  return [...selectedIds, seat.id];
}

export function reconcileStaffMapSeatSelection<T extends { id: string; status: string; isOwnHold?: boolean }>(
  latestSeats: T[],
  currentSeats: T[],
  selectedIds: string[],
  _ownHeldIds: Set<string>,
) {
  const seats = latestSeats;
  const selectableIds = new Set(seats.filter((seat) =>
    seat.status === 'AVAILABLE' || (seat.status === 'HELD' && seat.isOwnHold === true),
  ).map((seat) => seat.id));
  const nextSelectedIds = selectedIds.filter((seatId) => selectableIds.has(seatId));
  const expiredOwnHold = currentSeats.some((previous) =>
    previous.isOwnHold === true && latestSeats.find((seat) => seat.id === previous.id)?.isOwnHold !== true,
  );
  return {
    seats,
    selectedIds: nextSelectedIds,
    removedUnavailable: nextSelectedIds.length !== selectedIds.length,
    expiredOwnHold,
  };
}

export function StaffSeatPickerDialog({
  open,
  onOpenChange,
  eventId,
  mapId,
  initialHoldToken,
  initialSeatIds,
  onConfirm,
  onHoldExpired,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  mapId: string;
  initialHoldToken?: string | null;
  initialSeatIds?: string[];
  onConfirm: (result: StaffSeatReservationResult) => void;
  onHoldExpired?: () => void;
}) {
  const [map, setMap] = useState<StaffEventMapSalesViewDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSeatIds ?? []);
  const [activeLevelId, setActiveLevelId] = useState<string | null>(null);
  const hasMap = map !== null;
  const seatRefreshInFlight = useRef(false);
  const mapRef = useRef(map);
  const selectedIdsRef = useRef(selectedIds);
  const ownHeldIdsRef = useRef(new Set<string>());
  const onHoldExpiredRef = useRef(onHoldExpired);
  mapRef.current = map;
  selectedIdsRef.current = selectedIds;
  onHoldExpiredRef.current = onHoldExpired;

  useEffect(() => {
    if (!open) return;
    let active = true;
    setSelectedIds([...ownHeldIdsRef.current]);
    setError(null);
    setLoading(true);
    getStaffEventMapSalesView(eventId, mapId, initialHoldToken)
      .then((data) => {
        if (!active) return;
        setMap(data);
        const initialIds = [...ownHeldIdsRef.current];
        const reconciliation = reconcileStaffMapSeatSelection(
          data.seats,
          data.seats.filter((seat) => initialIds.includes(seat.id)).map((seat) => ({ ...seat, isOwnHold: true })),
          initialIds,
          new Set(initialIds),
        );
        if (reconciliation.expiredOwnHold) {
          setSelectedIds(reconciliation.selectedIds);
          setError('A reserva expirou ou foi substituída. Confira os assentos disponíveis e confirme novamente para criar uma nova reserva.');
          onHoldExpiredRef.current?.();
        }
        ownHeldIdsRef.current = new Set(data.seats.filter((seat) => seat.isOwnHold).map((seat) => seat.id));
        const levels = resolvePublicMapLevels(data.levels as PublicMapLevelView[]);
        setActiveLevelId(getDefaultPublicMapLevelId(levels));
      })
      .catch((loadError) => { if (active) setError((loadError as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, eventId, mapId]);

  useEffect(() => {
    if (!open || submitting || !mapRef.current || typeof document === 'undefined') return;
    let active = true;
    const refreshSeats = async () => {
      if (!active || document.visibilityState !== 'visible' || seatRefreshInFlight.current) return;
      seatRefreshInFlight.current = true;
      try {
        const latest = await getStaffEventMapSalesView(eventId, mapId, initialHoldToken);
        if (!active) return;
        const currentMap = mapRef.current;
        if (!currentMap) return;
        if (latest.versionId !== currentMap.versionId) {
          ownHeldIdsRef.current = new Set();
          setMap(latest);
          setSelectedIds([]);
          setActiveLevelId(getDefaultPublicMapLevelId(resolvePublicMapLevels(latest.levels as PublicMapLevelView[])));
          setError('O mapa foi atualizado. A seleção anterior foi limpa; escolha os assentos novamente.');
          onHoldExpiredRef.current?.();
          return;
        }
        const reconciliation = reconcileStaffMapSeatSelection(
          latest.seats,
          currentMap.seats,
          selectedIdsRef.current,
          ownHeldIdsRef.current,
        );
        ownHeldIdsRef.current = new Set(reconciliation.seats.filter((seat) => seat.isOwnHold).map((seat) => seat.id));
        if (reconciliation.expiredOwnHold) {
          setSelectedIds(reconciliation.selectedIds);
          setError('A reserva expirou ou foi substituída. Confira os assentos disponíveis e confirme novamente para criar uma nova reserva.');
          onHoldExpiredRef.current?.();
        } else if (reconciliation.removedUnavailable) {
          setSelectedIds(reconciliation.selectedIds);
          setError('Um ou mais assentos selecionados ficaram indisponíveis e foram removidos. Escolha outros assentos para continuar.');
        }
        setMap({ ...currentMap, seats: reconciliation.seats });
      } catch {
        // Best-effort refresh; selection remains usable and the next interval retries.
      } finally {
        seatRefreshInFlight.current = false;
      }
    };
    const interval = window.setInterval(() => void refreshSeats(), 9000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshSeats();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [eventId, hasMap, initialHoldToken, mapId, open, submitting]);

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
      { seats: map.seats },
      map.objects as StaffObject[],
      activeLevel.id,
    );
  }, [activeLevel, map]);
  const levelSeats = useMemo(() => {
    if (!map || !activeLevel) return [];
    return filterPublicMapSeatsByLevel(map.seats, activeLevel.id);
  }, [activeLevel, map]);
  const levelRenderItems = useMemo(() => {
    if (!map || !activeLevel) return [];
    return buildPublicMapSceneItems({
      levelId: activeLevel.id,
      document: map.document as EventMapDocument | null,
      levelObjects,
      levelSeats,
      allObjects: map.objects as StaffObject[],
      sections: map.sections as Array<{ id: string; sortOrder?: number }>,
    });
  }, [activeLevel, levelObjects, levelSeats, map]);
  const ownHeldIds = ownHeldIdsRef.current;
  const selectedSeats = useMemo(
    () => (map?.seats ?? []).filter((seat) => selectedIds.includes(seat.id)),
    [map?.seats, selectedIds],
  );
  const total = selectedSeats.reduce((sum, seat) => sum + seat.unitPrice, 0);

  function toggleSeat(seat: StaffSeat) {
    const nextIds = toggleStaffSeatSelection(seat, selectedIds, ownHeldIds);
    if (nextIds === selectedIds) return;
    setSelectedIds(nextIds);
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
                    <PublicMapSceneRenderer
                      items={levelRenderItems}
                      selectedSeatIds={selectedIds}
                      isSeatInteractive={(seat) => isSeatSelectable(seat, selectedIds, ownHeldIds)}
                      onSeatClick={toggleSeat}
                    />
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
