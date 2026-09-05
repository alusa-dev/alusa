import { PrismaClient } from '@prisma/client';

// Playwright loads E2E modules directly in Node. Use the generated client here
// instead of importing the app package, whose ESM build is resolved by Next.js.
const prisma = new PrismaClient();

export default prisma;
