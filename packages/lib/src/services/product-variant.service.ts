import { prisma } from '../prisma';
import type { ProductVariant, ProductVariantOption, ProductOptionValue } from '@prisma/client';
import { formatProductVariantTitle } from './product-variant-rules';
import {
  calculateAvailable,
  calculateProjected,
  ensureProductInventoryBalance,
  listInventoryBalanceRows,
  revalueInventoryAverageCostInTransaction,
} from './inventory-balance.service';

export type ProductVariantWithOptions = ProductVariant & {
  options: (ProductVariantOption & {
    optionValue: ProductOptionValue & { option: { name: string } };
  })[];
};

function mapVariantsWithInventory<
  T extends Array<
    ProductVariantWithOptions & {
      lowStockThreshold: number;
      stock: number;
      price: { toString(): string } | number | null;
      isActive: boolean;
    }
  >,
>(productId: string, variants: T, balances: Awaited<ReturnType<typeof listInventoryBalanceRows>>) {
  const balanceMap = new Map(
    balances
      .filter((balance): balance is typeof balance & { variantId: string } =>
        Boolean(balance.variantId),
      )
      .map((balance) => [balance.variantId, balance]),
  );

  return variants.map((variant) => {
    const balance = balanceMap.get(variant.id);
    const inventory = balance ?? {
      productId,
      variantId: variant.id,
      onHand: variant.stock,
      reserved: 0,
      incoming: 0,
      averageCost: 0,
    };
    const averageCost = Number(balance?.averageCost ?? 0);
    const available = calculateAvailable(inventory);
    const projected = calculateProjected(inventory);

    return {
      ...variant,
      title: formatProductVariantTitle(
        variant.options.map((entry) => ({
          name: entry.optionValue.option.name,
          value: entry.optionValue.value,
        })),
        variant.title,
      ),
      stock: inventory.onHand,
      onHand: inventory.onHand,
      reserved: inventory.reserved,
      available,
      incoming: inventory.incoming,
      projected,
      averageCost,
      inventoryValue: Number((inventory.onHand * averageCost).toFixed(4)),
    };
  });
}

export async function listProductVariants(
  productId: string,
  contaId: string,
): Promise<
  Array<
    ProductVariantWithOptions & {
      onHand: number;
      reserved: number;
      available: number;
      incoming: number;
      projected: number;
      averageCost: number;
      inventoryValue: number;
    }
  >
> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    include: {
      options: {
        include: {
          optionValue: { include: { option: { select: { name: true } } } },
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const balances = await listInventoryBalanceRows(contaId, [productId]);
  return mapVariantsWithInventory(productId, variants, balances);
}

export async function generateProductVariants(
  productId: string,
  contaId: string,
): Promise<
  Array<
    ProductVariantWithOptions & {
      onHand: number;
      reserved: number;
      available: number;
      incoming: number;
      projected: number;
      averageCost: number;
      inventoryValue: number;
    }
  >
> {
  const product = await prisma.product.findFirst({
    where: { id: productId, contaId },
    include: {
      options: {
        include: { values: { orderBy: [{ sortOrder: 'asc' }] } },
        orderBy: [{ sortOrder: 'asc' }],
      },
    },
  });
  if (!product) throw new Error('Produto não encontrado');
  if (product.options.length === 0)
    throw new Error('Adicione pelo menos uma variante antes de gerar valores');

  const existingBalances = await listInventoryBalanceRows(contaId, [productId]);
  const parentBalance = existingBalances.find((balance) => balance.variantId == null);
  if (
    parentBalance &&
    (parentBalance.onHand > 0 || parentBalance.reserved > 0 || parentBalance.incoming > 0)
  ) {
    throw new Error(
      'Não é possível gerar variantes quando o produto pai ainda possui saldo. Zere ou mova o estoque antes de ativar variantes.',
    );
  }

  // Cada opção representa uma variante agrupadora (ex.: Rosa) e cada valor
  // representa uma unidade vendável dentro dela (ex.: 31 ou 32).
  const variantValues = product.options.flatMap((option) =>
    option.values.map((value) => ({ option, value })),
  );

  // Variantes existentes para checar duplicidade
  const existing = await prisma.productVariant.findMany({
    where: { productId },
    include: { options: true },
  });

  const existingKeys = new Set(
    existing.map((v) =>
      v.options
        .map((o) => o.optionValueId)
        .sort()
        .join('|'),
    ),
  );

  const expectedValueIds = new Set(variantValues.map(({ value }) => value.id));
  const obsolete = existing.filter(
    (variant) =>
      variant.options.length !== 1 || !expectedValueIds.has(variant.options[0]?.optionValueId),
  );

  await prisma.$transaction(async (tx) => {
    const obsoleteIds = obsolete.map((variant) => variant.id);

    if (obsoleteIds.length > 0) {
      // Interactive transactions use a single database connection. Running
      // these checks with Promise.all makes a large legacy cleanup queue
      // queries on that connection and can close the transaction before the
      // following deleteMany call. Keep the checks grouped and sequential.
      const balances = await tx.inventoryBalance.findMany({
        where: {
          contaId,
          productId,
          variantId: { in: obsoleteIds },
        },
        select: {
          variantId: true,
          onHand: true,
          reserved: true,
          incoming: true,
        },
      });
      const balanceWithQuantity = balances.find(
        (balance) =>
          balance.variantId &&
          (balance.onHand > 0 || balance.reserved > 0 || balance.incoming > 0),
      );
      if (balanceWithQuantity) {
        const variant = obsolete.find((item) => item.id === balanceWithQuantity.variantId);
        throw new Error(
          `Não é possível reorganizar a variante "${variant?.title ?? 'desconhecida'}" porque ela possui estoque, reserva ou entrada pendente.`,
        );
      }

      const saleItems = await tx.saleItem.findMany({
        where: { variantId: { in: obsoleteIds } },
        select: { variantId: true },
        distinct: ['variantId'],
      });
      const restockItems = await tx.restockOrderItem.findMany({
        where: { variantId: { in: obsoleteIds } },
        select: { variantId: true },
        distinct: ['variantId'],
      });
      const inventoryMovements = await tx.inventoryMovement.findMany({
        where: { variantId: { in: obsoleteIds } },
        select: { variantId: true },
        distinct: ['variantId'],
      });
      const historicalVariantIds = new Set(
        [...saleItems, ...restockItems, ...inventoryMovements]
          .map((item) => item.variantId)
          .filter((variantId): variantId is string => Boolean(variantId)),
      );
      const variantWithHistory = obsolete.find((variant) => historicalVariantIds.has(variant.id));
      if (variantWithHistory) {
        throw new Error(
          `Não é possível reorganizar a variante "${variantWithHistory.title}" porque ela possui histórico registrado.`,
        );
      }

      // Both relations are tenant/product scoped and the checks above happen
      // in this same transaction, so the cleanup remains atomic and cannot
      // remove a variant that acquired stock or history concurrently.
      await tx.inventoryBalance.deleteMany({
        where: { contaId, productId, variantId: { in: obsoleteIds } },
      });
      await tx.productVariant.deleteMany({
        where: { productId, id: { in: obsoleteIds } },
      });
    }

    const retainedVariantCount = existing.length - obsolete.length;
    let nextSortOrder = retainedVariantCount;
    for (const { option, value } of variantValues) {
      const key = value.id;
      if (existingKeys.has(key)) continue;

      const variant = await tx.productVariant.create({
        data: {
          productId,
          title: `${option.name} · ${value.value}`,
          stock: 0,
          lowStockThreshold: product.lowStockThreshold,
          sortOrder: nextSortOrder,
          isDefault: nextSortOrder === 0 && retainedVariantCount === 0,
          options: {
            create: [{ optionValueId: value.id }],
          },
        },
      });

      await tx.inventoryBalance.upsert({
        where: {
          contaId_inventoryItemKey: {
            contaId,
            inventoryItemKey: `variant:${variant.id}`,
          },
        },
        update: {},
        create: {
          contaId,
          inventoryItemKey: `variant:${variant.id}`,
          productId,
          variantId: variant.id,
          onHand: 0,
          reserved: 0,
          incoming: 0,
          averageCost: 0,
        },
      });

      existingKeys.add(key);
      nextSortOrder++;
    }

    // Marcar produto como hasVariants
    await tx.product.update({
      where: { id: productId },
      data: { hasVariants: true, stock: 0 },
    });
  }, { maxWait: 10_000, timeout: 30_000 });

  return listProductVariants(productId, contaId);
}

export async function updateProductVariant(input: {
  variantId: string;
  productId: string;
  contaId: string;
  actorUserId?: string | null;
  sku?: string | null;
  price?: number | null;
  averageCost?: number;
  lowStockThreshold?: number;
  imageUrl?: string | null;
  isActive?: boolean;
}): Promise<
  ProductVariantWithOptions & {
    onHand: number;
    reserved: number;
    available: number;
    incoming: number;
    projected: number;
    averageCost: number;
    inventoryValue: number;
  }
> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, contaId: input.contaId },
  });
  if (!product) throw new Error('Produto não encontrado');

  const variant = await prisma.productVariant.findFirst({
    where: { id: input.variantId, productId: input.productId },
  });
  if (!variant) throw new Error('Variante não encontrada');

  if (input.sku !== undefined && input.sku !== null && input.sku !== variant.sku) {
    const dup = await prisma.productVariant.findFirst({
      where: { productId: input.productId, sku: input.sku, id: { not: input.variantId } },
    });
    if (dup) throw new Error('Já existe uma variante com este SKU');
  }

  const data: Record<string, unknown> = {};
  if (input.sku !== undefined) data.sku = input.sku || null;
  if (input.price !== undefined) data.price = input.price ?? null;
  if (input.lowStockThreshold !== undefined)
    data.lowStockThreshold = Math.max(0, input.lowStockThreshold);
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.productVariant.update({ where: { id: input.variantId }, data });
    }

    if (input.averageCost !== undefined) {
      await revalueInventoryAverageCostInTransaction(
        tx,
        {
          contaId: input.contaId,
          productId: input.productId,
          variantId: input.variantId,
          averageCost: input.averageCost,
          actorUserId: input.actorUserId,
          reason: 'Atualização manual do custo médio da variante.',
        },
        input.averageCost,
      );
    }
  });

  const updated = await prisma.productVariant.findFirst({
    where: { id: input.variantId },
    include: {
      options: {
        include: { optionValue: { include: { option: { select: { name: true } } } } },
      },
    },
  });
  if (!updated) throw new Error('Variante não encontrada após atualização');

  const balances = await listInventoryBalanceRows(input.contaId, [input.productId]);
  const [mapped] = mapVariantsWithInventory(input.productId, [updated], balances);
  return mapped;
}

export async function bulkUpdateProductVariants(input: {
  productId: string;
  contaId: string;
  actorUserId?: string | null;
  variantIds: string[];
  price: number;
  averageCost: number;
}): Promise<Awaited<ReturnType<typeof listProductVariants>>> {
  const variantIds = [...new Set(input.variantIds.filter(Boolean))];
  if (variantIds.length === 0) throw new Error('Selecione pelo menos uma variante.');
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error('Informe um preço de venda válido.');
  }
  if (!Number.isFinite(input.averageCost) || input.averageCost < 0) {
    throw new Error('Informe um custo válido.');
  }

  await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: input.productId, contaId: input.contaId },
      select: { id: true },
    });
    if (!product) throw new Error('Produto não encontrado');

    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds }, productId: input.productId },
      select: { id: true },
    });
    if (variants.length !== variantIds.length) {
      throw new Error('Uma ou mais variantes não pertencem a este produto.');
    }

    await tx.productVariant.updateMany({
      where: { id: { in: variantIds }, productId: input.productId },
      data: { price: Number(input.price.toFixed(2)) },
    });

    const averageCost = Number(input.averageCost.toFixed(4));
    for (const variantId of variantIds) {
      await revalueInventoryAverageCostInTransaction(
        tx,
        {
          contaId: input.contaId,
          productId: input.productId,
          variantId,
          averageCost,
          actorUserId: input.actorUserId,
          reason: 'Precificação em massa do grupo de variantes.',
        },
        averageCost,
      );
    }
  }, { maxWait: 10_000, timeout: 30_000 });

  return listProductVariants(input.productId, input.contaId);
}

export async function deleteProductVariant(
  variantId: string,
  productId: string,
  contaId: string,
): Promise<void> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  const variant = await prisma.productVariant.findFirst({ where: { id: variantId, productId } });
  if (!variant) throw new Error('Variante não encontrada');

  const balances = await listInventoryBalanceRows(contaId, [productId]);
  const variantBalance = balances.find((balance) => balance.variantId === variantId);
  if (
    variantBalance &&
    (variantBalance.onHand > 0 || variantBalance.reserved > 0 || variantBalance.incoming > 0)
  ) {
    throw new Error('Não é possível excluir uma variante com saldo, reserva ou entrada pendente.');
  }

  await prisma.inventoryBalance.deleteMany({
    where: {
      contaId,
      productId,
      variantId,
    },
  });

  await prisma.productVariant.delete({ where: { id: variantId } });

  // Se não restarem variantes, remover flag
  const remaining = await prisma.productVariant.count({ where: { productId } });
  if (remaining === 0) {
    await prisma.product.update({
      where: { id: productId },
      data: { hasVariants: false, stock: 0 },
    });
    await ensureProductInventoryBalance({
      contaId,
      productId,
      initialOnHand: 0,
    });
  }
}
