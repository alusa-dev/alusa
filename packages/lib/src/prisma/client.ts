// Prisma client leve para testes da lib.
// Em produção, o app web usa seu próprio client com migrations completas.

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
