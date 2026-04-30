import { z } from 'zod';

export const globalAdminSeveritySchema = z.enum(['info', 'warning', 'critical']);
export type GlobalAdminSeverity = z.infer<typeof globalAdminSeveritySchema>;

export const globalAdminStatusSchema = z.enum(['OK', 'WARNING', 'ERROR']);
export type GlobalAdminStatus = z.infer<typeof globalAdminStatusSchema>;
