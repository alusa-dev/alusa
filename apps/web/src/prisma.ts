// Adapter de compatibilidade para rotas legadas que importam `@/src/prisma`.
// O cliente efetivo continua sendo o singleton canônico de `@alusa/database`,
// exposto por `@/lib/prisma` para preservar os contratos de teste existentes.
export { prisma, prisma as default } from '@/lib/prisma';
