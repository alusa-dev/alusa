import { prisma } from '@alusa/database';
import {
  createCommercialSchoolInvitation as create,
  findReusableSchoolInvitation as findReusable,
  getCommercialSchoolInvitation as get,
  listCommercialSchoolInvitations as list,
  resendCommercialSchoolInvitation as resend,
  updateCommercialSchoolInvitation as update,
} from './use-cases';

export const listCommercialSchoolInvitations = () => list(prisma);
export const getCommercialSchoolInvitation = (id: string) => get(prisma, id);
export const findReusableSchoolInvitation = (requestKey: string) => findReusable(prisma, requestKey);
export const createCommercialSchoolInvitation = (input: Omit<Parameters<typeof create>[0], 'db'>) => create({ ...input, db: prisma });
export const resendCommercialSchoolInvitation = (input: Omit<Parameters<typeof resend>[0], 'db'>) => resend({ ...input, db: prisma });
export const updateCommercialSchoolInvitation = (input: Omit<Parameters<typeof update>[0], 'db'>) => update({ ...input, db: prisma });
