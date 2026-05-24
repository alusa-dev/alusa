import { z } from 'zod';

import {
  EVENT_MAP_OBJECT_TYPES,
  EVENT_SEAT_STATUSES,
} from '@alusa/shared';

import { sanitizeTextObjectData } from './text-object.schema';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const requiredText = (message: string, max = 255) =>
  z.string({ required_error: message }).trim().min(1, message).max(max);

const optionalText = z.preprocess(
  emptyToUndefined,
  z.string().trim().max(4000).optional().nullable(),
);

const idSchema = z.string().trim().min(1).max(120);
const positiveSize = z.coerce.number().finite().positive();
const coordinate = z.coerce.number().finite();

export const eventMapIdSchema = z.string().trim().min(1);

export const createEventMapSchema = z.object({
  name: requiredText('Informe o nome do mapa.').default('Mapa principal'),
  templateMapId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
});

export const eventMapLevelSchema = z.object({
  id: idSchema,
  name: requiredText('Informe o nome da prancheta.'),
  sortOrder: z.coerce.number().int().min(0).default(0),
  widthPx: z.coerce.number().int().min(320).max(20000),
  heightPx: z.coerce.number().int().min(240).max(20000),
  unit: z.string().trim().min(1).max(24).default('px'),
  scale: z.string().trim().max(80).optional().nullable(),
});

export const eventMapSectionSchema = z.object({
  id: idSchema,
  levelId: idSchema,
  lotId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional().nullable()),
  name: requiredText('Informe o nome do setor.'),
  color: z.string().trim().min(4).max(32),
  capacity: z.coerce.number().int().nonnegative().optional().nullable(),
  status: z.string().trim().min(1).max(40).default('ACTIVE'),
  notes: optionalText,
});

export const eventMapObjectSchema = z
  .object({
    id: idSchema,
    levelId: idSchema,
    sectionId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional().nullable()),
    type: z.enum(EVENT_MAP_OBJECT_TYPES),
    data: z.record(z.unknown()).default({}),
    x: coordinate,
    y: coordinate,
    width: positiveSize.optional().nullable(),
    height: positiveSize.optional().nullable(),
    rotation: z.coerce.number().finite().default(0),
    locked: z.coerce.boolean().default(false),
    hidden: z.coerce.boolean().default(false),
    sortOrder: z.coerce.number().int().min(0).default(0),
  })
  .transform((object) =>
    object.type === 'TEXT'
      ? { ...object, data: sanitizeTextObjectData(object.data as Record<string, unknown>) }
      : object,
  );

export const eventSeatSchema = z.object({
  id: idSchema,
  levelId: idSchema,
  sectionId: idSchema,
  objectId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional().nullable()),
  groupId: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional().nullable()),
  rowIndex: z.coerce.number().int().min(0).optional().nullable(),
  columnIndex: z.coerce.number().int().min(0).optional().nullable(),
  technicalCode: z.string().trim().min(1).max(120),
  displayLabel: z.string().trim().min(1).max(120),
  rowLabel: z.string().trim().max(80).optional().nullable(),
  seatNumber: z.string().trim().max(80).optional().nullable(),
  status: z.enum(EVENT_SEAT_STATUSES).default('AVAILABLE'),
  accessible: z.coerce.boolean().default(false),
  publicVisible: z.coerce.boolean().default(true),
  x: coordinate,
  y: coordinate,
  size: positiveSize.optional().nullable(),
  rotation: z.coerce.number().finite().default(0),
});

export const eventSeatGroupSchema = z.object({
  id: idSchema,
  levelId: idSchema,
  name: z.string().trim().max(120).optional().nullable(),
  x: coordinate,
  y: coordinate,
  rotation: z.coerce.number().finite().default(0),
  rows: z.coerce.number().int().min(1).max(200),
  columns: z.coerce.number().int().min(1).max(200),
  seatWidth: z.coerce.number().finite().positive().default(28),
  seatHeight: z.coerce.number().finite().positive().default(28),
  gapX: z.coerce.number().finite().min(0).default(4),
  gapY: z.coerce.number().finite().min(0).default(4),
  paddingTop: z.coerce.number().finite().min(0).default(0),
  paddingRight: z.coerce.number().finite().min(0).default(0),
  paddingBottom: z.coerce.number().finite().min(0).default(0),
  paddingLeft: z.coerce.number().finite().min(0).default(0),
  numbering: z.record(z.unknown()).default({}),
  locked: z.coerce.boolean().default(false),
});

export const updateEventMapDraftSchema = z.object({
  name: requiredText('Informe o nome do mapa.').optional(),
  levels: z.array(eventMapLevelSchema).min(1, 'Crie pelo menos uma prancheta.'),
  sections: z.array(eventMapSectionSchema).default([]),
  objects: z.array(eventMapObjectSchema).default([]),
  seatGroups: z.array(eventSeatGroupSchema).default([]),
  seats: z.array(eventSeatSchema).default([]),
});

export const duplicateEventMapSchema = z.object({
  name: requiredText('Informe o nome do novo mapa.').optional(),
});

export type CreateEventMapInput = z.infer<typeof createEventMapSchema>;
export type UpdateEventMapDraftInput = z.infer<typeof updateEventMapDraftSchema>;
export type DuplicateEventMapInput = z.infer<typeof duplicateEventMapSchema>;
export type EventSeatGroupInput = z.infer<typeof eventSeatGroupSchema>;
