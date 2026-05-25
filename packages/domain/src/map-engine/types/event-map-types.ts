import type {
  EventMapObjectType,
  EventMapStatus,
  EventSeatStatus,
  EventTicketLotStatus,
} from '@alusa/shared';

export type EventMapLevelDTO = {
  id: string;
  name: string;
  sortOrder: number;
  widthPx: number;
  heightPx: number;
  unit: string;
  scale: string | null;
};

export type EventMapSectionDTO = {
  id: string;
  levelId: string;
  lotId: string | null;
  lot: {
    id: string;
    name: string;
    unitPrice: number;
    status: EventTicketLotStatus;
    quantityTotal: number;
    quantitySold: number;
  } | null;
  name: string;
  color: string;
  capacity: number | null;
  status: string;
  notes: string | null;
};

export type EventMapObjectDTO = {
  id: string;
  levelId: string;
  sectionId: string | null;
  type: EventMapObjectType;
  data: Record<string, unknown>;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  locked: boolean;
  hidden: boolean;
  sortOrder: number;
};

export type EventSeatDTO = {
  id: string;
  levelId: string;
  sectionId: string;
  objectId: string | null;
  groupId: string | null;
  rowIndex: number | null;
  columnIndex: number | null;
  technicalCode: string;
  displayLabel: string;
  rowLabel: string | null;
  seatNumber: string | null;
  status: EventSeatStatus;
  accessible: boolean;
  publicVisible: boolean;
  x: number;
  y: number;
  size: number | null;
  rotation: number;
};

export type EventSeatGroupDTO = {
  id: string;
  levelId: string;
  name: string | null;
  x: number;
  y: number;
  rotation: number;
  rows: number;
  columns: number;
  seatWidth: number;
  seatHeight: number;
  gapX: number;
  gapY: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  numbering: Record<string, unknown>;
  locked: boolean;
};

export type EventMapDTO = {
  id: string;
  contaId: string;
  eventId: string;
  event: { id: string; name: string; startsAt: string; status: string; ticketMode: string };
  name: string;
  status: EventMapStatus;
  publishedVersionId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  levels: EventMapLevelDTO[];
  sections: EventMapSectionDTO[];
  objects: EventMapObjectDTO[];
  seatGroups: EventSeatGroupDTO[];
  seats: EventSeatDTO[];
  versions: Array<{ id: string; version: number; status: EventMapStatus; createdAt: string }>;
  counts: {
    levels: number;
    sections: number;
    seats: number;
    availableSeats: number;
  };
};

export type EventMapDraftPayload = {
  name?: string;
  levels: EventMapLevelDTO[];
  sections: Array<Omit<EventMapSectionDTO, 'lot'>>;
  objects: EventMapObjectDTO[];
  seatGroups: EventSeatGroupDTO[];
  seats: EventSeatDTO[];
};

export type MapTool =
  | 'select'
  | 'pan'
  | 'zoom'
  | 'section'
  | 'row'
  | 'seat'
  | 'table'
  | 'stage'
  | 'text'
  | 'blocked'
  | 'corridor'
  | 'booth'
  | 'general'
  | 'shape-square'
  | 'shape-circle'
  | 'shape-ellipse'
  | 'shape-triangle';

