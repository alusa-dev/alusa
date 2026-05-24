import type { ID } from '../geometry/types.js';
import type { SeatGroup, Seat } from '../seat-groups/types.js';
import type { SmartCorridor } from '../corridors/types.js';

/** Estado imutável da engine de layout de mapas. */
export type MapLayoutState = {
  mapId: ID;
  levelId: ID;
  seatGroups: ReadonlyMap<ID, SeatGroup>;
  seats: ReadonlyMap<ID, Seat>;
  corridors: ReadonlyMap<ID, SmartCorridor>;
};

export type MapLayoutWarning = {
  code: string;
  entityId?: ID;
  message?: string;
};

/** Resultado de aplicar uma operação ao estado da engine. */
export type MapLayoutResult = {
  state: MapLayoutState;
  warnings: MapLayoutWarning[];
};

export function createEmptyMapLayoutState(mapId: ID, levelId: ID): MapLayoutState {
  return {
    mapId,
    levelId,
    seatGroups: new Map(),
    seats: new Map(),
    corridors: new Map(),
  };
}
