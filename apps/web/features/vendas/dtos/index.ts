import { InventoryMovementType, RestockOrderStatus } from '@prisma/client';
import { z } from 'zod';

import { isValidCpfCnpjDigits } from '@alusa/shared/validators/cpf-cnpj';

export const vendasClienteDocumentoQueryDTOSchema = z.object({
  document: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => isValidCpfCnpjDigits(value), 'CPF/CNPJ inválido.'),
  uiRequestId: z.string().trim().min(1).optional().nullable(),
});

export const listInventoryMovementsQueryDTOSchema = z.object({
  productId: z.string().trim().optional(),
  variantId: z.string().trim().optional(),
  movementType: z.nativeEnum(InventoryMovementType).optional(),
  search: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  actorUserId: z.string().trim().optional(),
  originType: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const restockItemDTOSchema = z.object({
  productId: z.string().trim().min(1),
  variantId: z.string().trim().optional().nullable(),
  quantity: z.number().int().positive(),
  unitCost: z.number().min(0),
});

export const listRestockOrdersQueryDTOSchema = z.object({
  status: z.union([z.literal('TODOS'), z.nativeEnum(RestockOrderStatus)]).optional(),
  search: z.string().trim().optional(),
});

export const createRestockOrderInputDTOSchema = z.object({
  requestId: z.string().trim().optional(),
  supplierName: z.string().trim().optional().nullable(),
  expectedAt: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  items: z.array(restockItemDTOSchema).min(1),
});

export type VendasClienteDocumentoQueryDTO = z.infer<typeof vendasClienteDocumentoQueryDTOSchema>;
export type ListInventoryMovementsQueryDTO = z.infer<typeof listInventoryMovementsQueryDTOSchema>;
export type ListRestockOrdersQueryDTO = z.infer<typeof listRestockOrdersQueryDTOSchema>;
export type CreateRestockOrderInputDTO = z.infer<typeof createRestockOrderInputDTOSchema>;

export const productOptionCreateInputDTOSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

export const productOptionValueCreateInputDTOSchema = z.object({
  value: z.string().trim().min(1).max(100),
});

export const productVariantUpdateInputDTOSchema = z.object({
  sku: z.string().trim().max(100).nullable().optional(),
  price: z.coerce.number().nonnegative().nullable().optional(),
  averageCost: z.coerce.number().nonnegative().optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
  imageUrl: z.string().trim().max(2_000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const productImagesReorderInputDTOSchema = z.object({
  orderedIds: z.array(z.string().trim().min(1).max(191)).min(1).max(100),
});
