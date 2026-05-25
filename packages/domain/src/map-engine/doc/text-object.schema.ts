import { z } from 'zod';

export const TEXT_MODES = ['auto', 'fixed-width', 'area'] as const;

export const textObjectDataSchema = z
  .object({
    text: z.string().max(10000).optional(),
    label: z.string().max(255).optional(),
    textMode: z.enum(TEXT_MODES).optional(),
    fontSize: z.coerce.number().finite().min(6).max(512).optional(),
    fontFamily: z.string().max(120).optional(),
    fontWeight: z.enum(['normal', 'bold']).optional(),
    italic: z.coerce.boolean().optional(),
    underline: z.coerce.boolean().optional(),
    lineThrough: z.coerce.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    lineHeight: z.coerce.number().finite().min(0.5).max(4).optional(),
    letterSpacing: z.coerce.number().finite().min(-50).max(200).optional(),
    fill: z.string().max(32).optional(),
    stroke: z.string().max(32).optional(),
    strokeWidth: z.coerce.number().finite().min(0).max(40).optional(),
    opacity: z.coerce.number().finite().min(0).max(1).optional(),
  })
  .passthrough();

export type TextObjectData = z.infer<typeof textObjectDataSchema>;

export function sanitizeTextObjectData(data: Record<string, unknown>): Record<string, unknown> {
  const parsed = textObjectDataSchema.safeParse(data);
  if (!parsed.success) return data;
  return { ...data, ...parsed.data };
}
