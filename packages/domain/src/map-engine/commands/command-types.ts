import type { MapSelection } from '../selection/selection-utils.js';
import type { MapTool } from '../types/event-map-types.js';
import type { EventMapObjectDTO, EventSeatDTO, EventMapSectionDTO, EventMapLevelDTO, EventSeatGroupDTO } from '../types/event-map-types.js';
import type { SeatGridConfig } from '../layout/seat-grid.js';

export type MapCommand =
  | {
      type: 'ADD_OBJECT';
      payload: {
        id: string;
        tool: MapTool;
        point: { x: number; y: number };
        size?: { width?: number; height?: number };
      };
    }
  | {
      type: 'DELETE_SELECTION';
      payload: {
        selection: MapSelection;
      };
    }
  | {
      type: 'UPDATE_OBJECT';
      payload: {
        id: string;
        patch: Partial<EventMapObjectDTO>;
      };
    }
  | {
      type: 'MOVE_OBJECTS';
      payload: {
        objectIds?: string[];
        seatIds?: string[];
        delta: { x: number; y: number };
      };
    }
  | {
      type: 'RESIZE_OBJECTS';
      payload: {
        objects: Array<{ id: string; patch: Partial<Pick<EventMapObjectDTO, 'x' | 'y' | 'width' | 'height' | 'rotation'>> }>;
      };
    }
  | {
      type: 'ROTATE_OBJECTS';
      payload: {
        objects?: Array<{ id: string; patch: Partial<Pick<EventMapObjectDTO, 'x' | 'y' | 'rotation'>> }>;
        seats?: Array<{ id: string; patch: Partial<Pick<EventSeatDTO, 'x' | 'y' | 'rotation'>> }>;
      };
    }
  | {
      type: 'UPDATE_ITEMS';
      payload: {
        objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
        seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
        sections?: Array<{ id: string; patch: Partial<EventMapSectionDTO> }>;
        levels?: Array<{ id: string; patch: Partial<EventMapLevelDTO> }>;
        skipSeatBaseLayoutTranslation?: boolean;
        skipCorridorReflow?: boolean;
      };
    }
  | {
      type: 'ADD_LEVEL';
      payload: {
        levelId: string;
        name?: string;
      };
    }
  | {
      type: 'DELETE_LEVEL';
      payload: {
        levelId: string;
      };
    }
  | {
      type: 'ADD_ROW';
      payload: {
        point: { x: number; y: number };
        quantity: number;
      };
    }
  | {
      type: 'ADD_SEAT_GRID';
      payload: {
        point: { x: number; y: number };
        config: Partial<SeatGridConfig>;
      };
    }
  | {
      type: 'GROUP_OBJECTS';
      payload: {
        selection: MapSelection;
      };
    }
  | {
      type: 'UNGROUP_OBJECTS';
      payload: {
        selection: MapSelection;
      };
    }
  | {
      type: 'UPDATE_TEXT';
      payload: {
        id: string;
        text: string;
        data?: Record<string, unknown>;
      };
    }
  | {
      type: 'UPDATE_LEVEL';
      payload: {
        id: string;
        patch: Partial<EventMapLevelDTO>;
      };
    }
  | {
      type: 'TRANSFORM_CORRIDOR';
      payload: {
        objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
        seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
        skipSeatBaseLayoutTranslation?: boolean;
        skipCorridorReflow?: boolean;
      };
    }
  | {
      type: 'DUPLICATE_SELECTION';
      payload: {
        selection: MapSelection;
      };
    }
  | {
      type: 'GROUP_SELECTION';
      payload: {
        selection: MapSelection;
      };
    }
  | {
      type: 'UNGROUP_SELECTION';
      payload: {
        selection: MapSelection;
      };
    }
  | {
      type: 'UPDATE_SEAT_GROUP';
      payload: {
        id: string;
        patch: Partial<EventSeatGroupDTO>;
      };
    }
  | {
      type: 'DELETE_SEAT_GROUP';
      payload: {
        id: string;
      };
    }
  | {
      type: 'NUDGE_SELECTION';
      payload: {
        delta: { x: number; y: number };
      };
    }
  | {
      type: 'RESTORE_DELETED_ITEMS';
      payload: {
        objects: EventMapObjectDTO[];
        seats: EventSeatDTO[];
        sections: EventMapSectionDTO[];
        levels: EventMapLevelDTO[];
        seatGroups?: EventSeatGroupDTO[];
      };
    }
  | {
      type: 'RESTORE_OBJECT_GROUPS';
      payload: {
        objects: Array<{ id: string; prevData: Record<string, unknown> }>;
      };
    };
