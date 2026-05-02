/**
 * @file eslint-plugin-tenant-safety.mjs
 * @description Plugin ESLint customizado para garantir boas práticas de isolamento
 * multitenant no codebase Alusa.
 *
 * Regras disponíveis:
 * - `no-unscoped-prisma-findmany`: Avisa quando prisma.modelo.findMany() ou
 *   findFirst() é chamado sem a propriedade `contaId` na cláusula `where`,
 *   sugerindo o uso do createTenantPrismaClient().
 *
 * - `require-tenant-client`: Avisa quando o `prisma` padrão é importado em
 *   route handlers ou server actions que deveriam usar o cliente de tenant.
 *
 * Uso no eslint.config.js:
 *   import tenantSafety from './eslint-plugin-tenant-safety.mjs';
 *   export default [
 *     ...
 *     { plugins: { 'tenant-safety': tenantSafety }, rules: { ... } }
 *   ];
 */

// Lista de modelos tenant-aware para detecção no AST
const TENANT_AWARE_MODELS = [
  'colaborador', 'professor', 'aluno', 'turma', 'modalidade', 'sala',
  'plano', 'combo', 'desconto', 'matricula', 'cobranca', 'lancamento',
  'centroCusto', 'categoriaLancamento', 'calendarEvent', 'attendanceRecord',
  'makeupClass', 'aulasOperationLog', 'portalEvento', 'contratoTemplate',
  'contratoModelo', 'notification', 'notificationRecipient', 'auditLog',
  'financeProfile', 'customer', 'charge', 'chargeReadModel',
  'standaloneInstallmentPlan', 'standaloneSubscription', 'invoice',
  'subscription', 'installmentPlan', 'transferRequest', 'pixTransferSession',
  'tenantFeatureFlags', 'productCategory', 'product', 'sale',
  'inventoryBalance', 'inventoryMovement', 'restockOrder',
  'webhookAsaas', 'logFinanceiro', 'logIntegracao', 'asaasIntegrationJob',
  'rematriculaOperacao', 'payerChangeOperacao', 'matriculaOperacao',
];

const SCOPED_OPERATIONS = ['findMany', 'findFirst', 'findFirstOrThrow', 'update', 'updateMany', 'delete', 'deleteMany', 'count'];

/**
 * Verifica se uma cláusula `where` num CallExpression contém `contaId`
 */
function whereHasContaId(callNode) {
  const args = callNode.arguments;
  if (!args || args.length === 0) return false;

  const firstArg = args[0];
  if (!firstArg || firstArg.type !== 'ObjectExpression') return false;

  return firstArg.properties.some(
    (prop) =>
      prop.type === 'Property' &&
      prop.key &&
      (prop.key.name === 'contaId' || prop.key.value === 'contaId'),
  );
}

const tenantSafetyPlugin = {
  meta: {
    name: 'tenant-safety',
    version: '1.0.0',
  },
  rules: {
    /**
     * Regra: no-unscoped-prisma-query
     *
     * Avisa quando uma query Prisma numa model tenant-aware é feita sem
     * o `contaId` explícito, sugerindo o uso do createTenantPrismaClient().
     *
     * Detecta padrão: prisma.MODEL.OPERATION({ where: { ... } })
     * onde MODEL é tenant-aware e a cláusula where não contém `contaId`.
     */
    'no-unscoped-prisma-query': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Queries em modelos tenant-aware devem conter contaId no where, ou usar createTenantPrismaClient().',
          category: 'Best Practices',
          recommended: true,
          url: 'https://github.com/alusa/apps/web/lib/prisma-tenant.ts',
        },
        messages: {
          missingContaId:
            "[Tenant Safety] '{{model}}.{{operation}}()' num modelo tenant-aware sem 'contaId' no where. " +
            "Use createTenantPrismaClient(contaId) para isolamento automático, ou adicione '{ where: { contaId } }' explicitamente.",
        },
        schema: [],
      },
      create(context) {
        return {
          CallExpression(node) {
            // Detectar padrão: prisma.MODEL.OPERATION(...)
            if (
              node.callee.type !== 'MemberExpression' ||
              node.callee.object.type !== 'MemberExpression'
            ) {
              return;
            }

            const outerMember = node.callee; // .OPERATION
            const innerMember = node.callee.object; // prisma.MODEL

            const operation =
              outerMember.property.type === 'Identifier' ? outerMember.property.name : null;
            const model =
              innerMember.property.type === 'Identifier' ? innerMember.property.name : null;

            if (!operation || !model) return;
            if (!SCOPED_OPERATIONS.includes(operation)) return;

            const modelNormalized = model.charAt(0).toLowerCase() + model.slice(1);
            if (!TENANT_AWARE_MODELS.includes(modelNormalized)) return;

            // Se a query não tem contaId no where, emite aviso
            if (!whereHasContaId(node)) {
              context.report({
                node,
                messageId: 'missingContaId',
                data: { model, operation },
              });
            }
          },
        };
      },
    },

    /**
     * Regra: prefer-tenant-client
     *
     * Avisa quando `import prisma from '@/lib/prisma'` é encontrado em arquivos
     * de route handlers (app/api/**) ou server actions, sugerindo o uso do
     * createTenantPrismaClient() para garantir isolamento automático.
     */
    'prefer-tenant-client': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Em route handlers e server actions, prefira createTenantPrismaClient() ao prisma padrão.',
          category: 'Best Practices',
          recommended: false,
        },
        messages: {
          preferTenantClient:
            "[Tenant Safety] Considere usar 'createTenantPrismaClient(contaId)' de '@/lib/prisma-tenant' " +
            'ao invés do cliente Prisma padrão em route handlers. Isso garante isolamento automático de tenant.',
        },
        schema: [],
      },
      create(context) {
        const filename = context.getFilename ? context.getFilename() : '';
        const isRouteHandler =
          filename.includes('/app/api/') || filename.includes('/app/(app)/');

        if (!isRouteHandler) return {};

        return {
          ImportDeclaration(node) {
            if (
              node.source.value === '@/lib/prisma' ||
              node.source.value === '../prisma' ||
              node.source.value === '../../prisma'
            ) {
              context.report({
                node,
                messageId: 'preferTenantClient',
              });
            }
          },
        };
      },
    },
  },
};

export default tenantSafetyPlugin;
