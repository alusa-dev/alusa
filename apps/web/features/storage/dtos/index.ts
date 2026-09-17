import { z } from 'zod';

export const deleteUploadInputDTOSchema = z.object({
  url: z.string().trim().min(1),
});

export const storageFileRouteParamsDTOSchema = z.object({
  key: z.array(z.string().min(1).max(512)).min(1).max(20),
});

export type DeleteUploadInputDTO = z.infer<typeof deleteUploadInputDTOSchema>;
export type StorageFileRouteParamsDTO = z.infer<typeof storageFileRouteParamsDTOSchema>;
