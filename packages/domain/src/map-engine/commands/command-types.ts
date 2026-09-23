import type { MapSelection } from '../selection/selection-utils.js';
import type { MapTool } from '../types/event-map-types.js';
import type { EventMapObjectDTO, EventSeatDTO, EventMapSectionDTO, EventMapLevelDTO } from '../types/event-map-types.js';
import type { EventMapDocument } from '../model/event-map-document.js';

export type MapCommand =
  | {
      type: 'REPLACE_DOCUMENT';
      payload: {
        before: EventMapDocument;
        after: EventMapDocument;
        description?: string;
      };
    }
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
      type: 'MOVE_SELECTION';
      payload: {
        selection: MapSelection;
        delta: { x: number; y: number };
      };
    }
  | {
      type: 'RESIZE_OBJECTS';
      payload: {
        objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
        seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
        skipSeatBaseLayoutTranslation?: boolean;
      };
    }
  | {
      type: 'RESIZE_SELECTION';
      payload: {
        selection: MapSelection;
        scaleX?: number;
        scaleY?: number;
        pivot?: { x: number; y: number } | null;
        objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
        seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
        skipSeatBaseLayoutTranslation?: boolean;
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
      type: 'ROTATE_SELECTION';
      payload: {
        selection: MapSelection;
        angleDelta: number;
        pivot?: { x: number; y: number } | null;
        mode?: 'free' | 'snap';
        snapStepDegrees?: number;
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
      };
    }
  | {
      type: 'RESTORE_OBJECT_GROUPS';
      payload: {
        objects: Array<{ id: string; prevData: Record<string, unknown> }>;
      };
    };
