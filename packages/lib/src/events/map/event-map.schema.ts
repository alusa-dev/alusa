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

const mapPointSchema = z.object({ x: coordinate, y: coordinate });
const seatRowPathSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LINE'), start: mapPointSchema, end: mapPointSchema }),
  z.object({
    type: z.literal('ARC'),
    center: mapPointSchema,
    radius: positiveSize,
    startAngle: coordinate,
    endAngle: coordinate,
    clockwise: z.boolean(),
  }),
  z.object({ type: z.literal('POLYLINE'), points: z.array(mapPointSchema).min(2).max(500) }),
  z.object({ type: z.literal('BEZIER'), p0: mapPointSchema, p1: mapPointSchema, p2: mapPointSchema, p3: mapPointSchema }),
]);
const mapSeatSchema = z.object({
  id: idSchema,
  label: requiredText('Informe o nome do assento.', 120),
  technicalCode: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().max(120).optional(),
  accessible: z.boolean().optional(),
  publicVisible: z.boolean().optional(),
  rowIndex: z.number().int().nonnegative(),
  columnIndex: z.number().int().nonnegative(),
  position: mapPointSchema.optional(),
  rotation: coordinate.optional(),
});
const distributionSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SEATS'), count: z.number().int().nonnegative() }),
  z.object({ type: z.literal('GAP'), width: z.number().finite().min(0).max(10000) }),
]);
const mapSeatRowSchema = z.object({
  id: idSchema,
  sectionId: idSchema,
  blockId: idSchema.optional(),
  label: requiredText('Informe o nome da fileira.', 80),
  path: seatRowPathSchema,
  transformRotation: coordinate.optional(),
  seatGap: z.number().finite().min(0),
  seatSize: positiveSize,
  seatIds: z.array(idSchema),
  seats: z.array(mapSeatSchema),
  distribution: z.array(distributionSegmentSchema).min(1).max(200).optional(),
});
const mapSeatBlockSchema = z.object({
  id: idSchema,
  sectionId: idSchema,
  name: z.string().trim().max(120).optional().nullable(),
  transformRotation: coordinate.optional(),
  columnCount: z.number().int().min(1).optional(),
  rowGap: z.number().finite().min(0),
  defaultSeatGap: z.number().finite().min(0),
  distribution: z.array(distributionSegmentSchema).min(1).max(200),
  distributionMode: z.enum(['FIXED', 'PROGRESSIVE', 'FIT']).default('FIXED'),
  distributionAlignment: z.enum(['LEFT', 'CENTER', 'RIGHT']).default('LEFT'),
  firstRowSeatCount: z.number().int().nonnegative().optional(),
  lastRowSeatCount: z.number().int().nonnegative().optional(),
  fitMinimumSeatCount: z.number().int().nonnegative().optional(),
  fitMaximumSeatCount: z.number().int().nonnegative().optional(),
  rowIds: z.array(idSchema),
  rows: z.array(mapSeatRowSchema),
});
const mapSectionDocumentSchema = z.object({
  id: idSchema,
  levelId: idSchema,
  name: requiredText('Informe o nome do setor.'),
  color: z.string().trim().min(4).max(32),
  lotId: z.string().trim().min(1).optional().nullable(),
  capacity: z.number().int().nonnegative().optional().nullable(),
  status: z.string().trim().min(1).max(40).optional(),
  notes: optionalText,
  hidden: z.boolean().optional(),
  position: mapPointSchema,
  rotation: coordinate,
  outline: z.array(mapPointSchema).max(500),
  blockIds: z.array(idSchema),
  blocks: z.array(mapSeatBlockSchema),
});
const mapVisualElementSchema = z.object({
  id: idSchema,
  levelId: idSchema,
  sectionId: z.string().trim().min(1).optional().nullable(),
  type: z.string().trim().min(1).max(40),
  data: z.record(z.unknown()),
  x: coordinate,
  y: coordinate,
  width: positiveSize.optional().nullable(),
  height: positiveSize.optional().nullable(),
  rotation: coordinate,
  locked: z.boolean(),
  hidden: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
});
export const eventMapDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  sections: z.array(mapSectionDocumentSchema),
  visualElements: z.array(mapVisualElementSchema),
});

export const eventMapIdSchema = z.string().trim().min(1);

export const createEventMapSchema = z.object({
  name: requiredText('Informe o nome do mapa.').default('Mapa principal'),
  creationMode: z.enum(['blank', 'reference-plan']).default('blank'),
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

const mapReferenceCalibrationSchema = z.object({
  seatDiameter: positiveSize,
  seatPitch: z.number().finite().min(0),
  rowPitch: z.number().finite().min(0),
});

const mapReferenceTransformSchema = z.object({
  x: coordinate,
  y: coordinate,
  scale: positiveSize,
  rotation: coordinate,
});

export const eventMapReferenceChartSchema = z.object({
  url: z.string().trim().min(1).max(1000),
  storageKey: z.string().trim().min(1).max(500).nullable(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  width: positiveSize,
  height: positiveSize,
  visible: z.boolean(),
  opacity: z.number().finite().min(0.05).max(1),
  locked: z.boolean(),
  transform: mapReferenceTransformSchema,
  calibration: mapReferenceCalibrationSchema.nullable(),
});

export const updateEventMapDraftSchema = z.object({
  name: requiredText('Informe o nome do mapa.').optional(),
  document: eventMapDocumentSchema.optional(),
  levels: z.array(eventMapLevelSchema).min(1, 'Crie pelo menos uma prancheta.'),
  sections: z.array(eventMapSectionSchema).default([]),
  objects: z.array(eventMapObjectSchema).default([]),
  seats: z.array(eventSeatSchema).default([]),
});

export const updateEventMapSettingsSchema = z
  .object({
    name: requiredText('Informe o nome do mapa.').optional(),
    publicEnabled: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.publicEnabled !== undefined, {
    message: 'Informe ao menos uma configuração para salvar.',
  });

export const updateEventMapReferenceChartSchema = z.object({
  referenceChart: eventMapReferenceChartSchema.nullable(),
});

export const duplicateEventMapSchema = z.object({
  name: requiredText('Informe o nome do novo mapa.').optional(),
});

export const publicSeatReservationSchema = z.object({
  seatIds: z.array(idSchema).min(1, 'Selecione pelo menos um assento.'),
  checkoutKey: z.string().trim().min(12).max(120).optional().nullable(),
  buyerName: z.string().trim().max(120).optional().nullable(),
  buyerEmail: z.string().trim().email('Informe um e-mail válido.').max(180).optional().nullable(),
});

export const publicCheckoutSchema = z.object({
  reservationId: idSchema,
  holdToken: idSchema,
  buyerName: requiredText('Informe o nome do comprador.', 120),
  buyerEmail: z.string().trim().email('Informe um e-mail válido.').max(180),
  buyerDocument: z.string().trim().max(32).optional().nullable(),
  buyerAddress: z.string().trim().max(255).optional().nullable(),
  buyerAddressNumber: z.string().trim().max(32).optional().nullable(),
  buyerComplement: z.string().trim().max(255).optional().nullable(),
  buyerProvince: z.string().trim().max(255).optional().nullable(),
  buyerPostalCode: z.string().trim().max(32).optional().nullable(),
  paymentMethod: z.enum(['PIX', 'CREDIT_CARD', 'BOLETO']),
});

export type CreateEventMapInput = z.infer<typeof createEventMapSchema>;
export type UpdateEventMapDraftInput = z.infer<typeof updateEventMapDraftSchema>;
export type UpdateEventMapSettingsInput = z.infer<typeof updateEventMapSettingsSchema>;
export type UpdateEventMapReferenceChartInput = z.infer<typeof updateEventMapReferenceChartSchema>;
export type DuplicateEventMapInput = z.infer<typeof duplicateEventMapSchema>;
export type PublicSeatReservationInput = z.infer<typeof publicSeatReservationSchema>;
export const staffSeatReservationSchema = z.object({
  seatIds: z.array(idSchema).min(1, 'Selecione pelo menos um assento.'),
  holdToken: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional().nullable()),
});

export type StaffSeatReservationInput = z.infer<typeof staffSeatReservationSchema>;
export type PublicCheckoutInput = z.infer<typeof publicCheckoutSchema>;
