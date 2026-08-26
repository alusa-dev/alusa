import { prisma } from '../prisma';
import type { ProductVariant, ProductVariantOption, ProductOptionValue } from '@prisma/client';
import {
  calculateAvailable,
  calculateProjected,
  ensureProductInventoryBalance,
  listInventoryBalanceRows,
  setInventoryAverageCost,
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

  let sortOrder = existing.length;
  const expectedValueIds = new Set(variantValues.map(({ value }) => value.id));
  const obsolete = existing.filter(
    (variant) =>
      variant.options.length !== 1 || !expectedValueIds.has(variant.options[0]?.optionValueId),
  );

  await prisma.$transaction(async (tx) => {
    for (const variant of obsolete) {
      const balance = existingBalances.find((item) => item.variantId === variant.id);
      if (balance && (balance.onHand > 0 || balance.reserved > 0 || balance.incoming > 0)) {
        throw new Error(
          `Não é possível reorganizar a variante "${variant.title}" porque ela possui estoque, reserva ou entrada pendente.`,
        );
      }

      const [saleItems, restockItems, inventoryMovements] = await Promise.all([
        tx.saleItem.count({ where: { variantId: variant.id } }),
        tx.restockOrderItem.count({ where: { variantId: variant.id } }),
        tx.inventoryMovement.count({ where: { variantId: variant.id } }),
      ]);

      if (saleItems > 0 || restockItems > 0 || inventoryMovements > 0) {
        throw new Error(
          `Não é possível reorganizar a variante "${variant.title}" porque ela possui histórico registrado.`,
        );
      }

      await tx.inventoryBalance.deleteMany({
        where: { contaId, productId, variantId: variant.id },
      });
      await tx.productVariant.delete({ where: { id: variant.id } });
    }

    for (const { option, value } of variantValues) {
      const key = value.id;
      if (existingKeys.has(key)) continue;

      const variant = await tx.productVariant.create({
        data: {
          productId,
          title: `${option.name} · ${value.value}`,
          stock: 0,
          lowStockThreshold: product.lowStockThreshold,
          sortOrder,
          isDefault: sortOrder === 0 && existing.length === 0,
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
      sortOrder++;
    }

    // Marcar produto como hasVariants
    await tx.product.update({
      where: { id: productId },
      data: { hasVariants: true, stock: 0 },
    });
  });

  return listProductVariants(productId, contaId);
}

export async function updateProductVariant(input: {
  variantId: string;
  productId: string;
  contaId: string;
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

  if (Object.keys(data).length > 0) {
    await prisma.productVariant.update({ where: { id: input.variantId }, data });
  }

  if (input.averageCost !== undefined) {
    await setInventoryAverageCost({
      contaId: input.contaId,
      productId: input.productId,
      variantId: input.variantId,
      averageCost: input.averageCost,
    });
  }

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
