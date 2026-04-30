import { InventoryMovementType } from '@prisma/client';

import { prisma } from '../prisma';
import { productSchema } from '../schemas/product.schema';
import {
  calculateAvailable,
  calculateProjected,
  listInventoryBalanceRows,
  setInventoryAverageCost,
} from './inventory-balance.service';

export interface ProductListOptions {
  page?: number;
  pageSize?: number;
  q?: string;
  categoryId?: string;
  archived?: boolean;
  activeOnly?: boolean;
}

export async function createProduct(input: {
  contaId: string;
  name: string;
  description?: string;
  sku?: string;
  price: number;
  averageCost?: number;
  initialStock?: number;
  lowStockThreshold?: number;
  categoryId?: string | null;
}) {
  const parsed = productSchema.parse({
    name: input.name?.trim(),
    description: input.description?.trim() || undefined,
    sku: input.sku?.trim() || undefined,
    price: input.price,
    lowStockThreshold: input.lowStockThreshold ?? 5,
    categoryId: input.categoryId || null,
  });

  if (parsed.sku) {
    const exists = await prisma.product.findUnique({
      where: { contaId_sku: { contaId: input.contaId, sku: parsed.sku } },
    });
    if (exists) throw new Error('Já existe um produto com este SKU nesta conta');
  }

  if (parsed.categoryId) {
    const cat = await prisma.productCategory.findFirst({
      where: { id: parsed.categoryId, contaId: input.contaId },
    });
    if (!cat) throw new Error('Categoria não encontrada');
  }

  if (
    input.averageCost !== undefined &&
    (!Number.isFinite(input.averageCost) || input.averageCost < 0)
  ) {
    throw new Error('Informe um custo médio válido.');
  }

  const initialStock = input.initialStock ?? 0;
  if (!Number.isInteger(initialStock) || initialStock < 0) {
    throw new Error('Informe um estoque inicial válido.');
  }

  const created = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        contaId: input.contaId,
        name: parsed.name,
        description: parsed.description,
        sku: parsed.sku,
        price: parsed.price,
        stock: initialStock,
        lowStockThreshold: parsed.lowStockThreshold,
        categoryId: parsed.categoryId,
      },
      include: { category: true },
    });

    const inventoryBalance = await tx.inventoryBalance.upsert({
      where: {
        contaId_inventoryItemKey: {
          contaId: input.contaId,
          inventoryItemKey: `product:${created.id}`,
        },
      },
      update: {},
      create: {
        contaId: input.contaId,
        inventoryItemKey: `product:${created.id}`,
        productId: created.id,
        onHand: initialStock,
        reserved: 0,
        incoming: 0,
        averageCost: Number((input.averageCost ?? 0).toFixed(4)),
      },
    });

    if (initialStock > 0) {
      await tx.inventoryMovement.create({
        data: {
          contaId: input.contaId,
          inventoryItemKey: inventoryBalance.inventoryItemKey,
          productId: created.id,
          movementType: InventoryMovementType.OPENING_IN,
          onHandBefore: 0,
          onHandDelta: initialStock,
          onHandAfter: initialStock,
          reservedBefore: 0,
          reservedDelta: 0,
          reservedAfter: 0,
          incomingBefore: 0,
          incomingDelta: 0,
          incomingAfter: 0,
          unitCost: Number((input.averageCost ?? 0).toFixed(4)),
          totalCost: Number((initialStock * (input.averageCost ?? 0)).toFixed(4)),
          originType: 'PRODUCT_CREATE',
          originId: created.id,
          originActionKey: 'initial-stock',
          reason: 'Estoque inicial informado no cadastro do produto.',
        },
      });
    }

    return created;
  });

  const balances = await listInventoryBalanceRows(input.contaId, [created.id]);
  const [mapped] = mapProductsWithInventory([{ ...created, variants: [] }], balances);
  return mapped;
}

export async function updateProduct(input: {
  id: string;
  contaId: string;
  name?: string;
  description?: string;
  sku?: string;
  price?: number;
  averageCost?: number;
  lowStockThreshold?: number;
  categoryId?: string | null;
}) {
  const current = await prisma.product.findFirst({
    where: { id: input.id, contaId: input.contaId, archivedAt: null },
  });
  if (!current) throw new Error('Produto não encontrado');

  const merged = {
    name: input.name ?? current.name,
    description: input.description ?? current.description ?? undefined,
    sku: input.sku ?? current.sku ?? undefined,
    price: input.price ?? Number(current.price),
    lowStockThreshold: input.lowStockThreshold ?? current.lowStockThreshold,
    categoryId: input.categoryId !== undefined ? input.categoryId : current.categoryId,
  };
  const parsed = productSchema.parse(merged);

  if (parsed.sku && parsed.sku !== current.sku) {
    const dup = await prisma.product.findFirst({
      where: { contaId: input.contaId, sku: parsed.sku, id: { not: input.id } },
    });
    if (dup) throw new Error('Já existe um produto com este SKU nesta conta');
  }

  if (parsed.categoryId) {
    const cat = await prisma.productCategory.findFirst({
      where: { id: parsed.categoryId, contaId: input.contaId },
    });
    if (!cat) throw new Error('Categoria não encontrada');
  }

  if (input.averageCost !== undefined && current.hasVariants) {
    throw new Error('Produtos com variantes devem ter o custo definido em cada variante.');
  }

  if (
    input.averageCost !== undefined &&
    (!Number.isFinite(input.averageCost) || input.averageCost < 0)
  ) {
    throw new Error('Informe um custo médio válido.');
  }

  await prisma.product.updateMany({
    where: { id: input.id, contaId: input.contaId },
    data: {
      name: parsed.name,
      description: parsed.description,
      sku: parsed.sku,
      price: parsed.price,
      lowStockThreshold: parsed.lowStockThreshold,
      categoryId: parsed.categoryId,
    },
  });

  if (input.averageCost !== undefined) {
    await setInventoryAverageCost({
      contaId: input.contaId,
      productId: input.id,
      averageCost: input.averageCost,
    });
  }

  const updated = await prisma.product.findFirst({
    where: { id: input.id, contaId: input.contaId },
    include: {
      category: true,
      images: { where: { isPrimary: true }, take: 1, select: { url: true } },
      variants: {
        select: {
          id: true,
          title: true,
          sku: true,
          price: true,
          stock: true,
          lowStockThreshold: true,
          isActive: true,
        },
      },
    },
  });
  if (!updated) throw new Error('Produto não encontrado após atualização');

  const balances = await listInventoryBalanceRows(input.contaId, [updated.id]);
  const [mapped] = mapProductsWithInventory([updated], balances);
  return mapped;
}

function mapProductsWithInventory<
  T extends Array<{
    id: string;
    stock: number;
    price: { toString(): string } | number;
    lowStockThreshold: number;
    hasVariants: boolean;
    variants: Array<{
      id: string;
      stock: number;
      price: { toString(): string } | number | null;
      lowStockThreshold: number;
      isActive: boolean;
    }>;
  }>,
>(products: T, balances: Awaited<ReturnType<typeof listInventoryBalanceRows>>) {
  const productBalanceMap = new Map(
    balances
      .filter((balance) => balance.variantId == null)
      .map((balance) => [balance.productId, balance]),
  );
  const variantBalanceMap = new Map(
    balances
      .filter((balance): balance is typeof balance & { variantId: string } =>
        Boolean(balance.variantId),
      )
      .map((balance) => [balance.variantId, balance]),
  );

  return products.map((product) => {
    const productBalance = productBalanceMap.get(product.id);
    const mappedVariants = product.variants.map((variant) => {
      const balance = variantBalanceMap.get(variant.id);
      const inventory = balance ?? {
        productId: product.id,
        variantId: variant.id,
        onHand: variant.stock,
        reserved: 0,
        incoming: 0,
        averageCost: 0 as never,
      };
      const available = calculateAvailable(inventory);
      const projected = calculateProjected(inventory);
      const averageCost = Number(balance?.averageCost ?? 0);

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

    const derivedInventory = product.hasVariants
      ? mappedVariants.reduce(
          (acc, variant) => ({
            onHand: acc.onHand + variant.onHand,
            reserved: acc.reserved + variant.reserved,
            incoming: acc.incoming + variant.incoming,
          }),
          { onHand: 0, reserved: 0, incoming: 0 },
        )
      : (productBalance ?? {
          productId: product.id,
          variantId: null,
          onHand: product.stock,
          reserved: 0,
          incoming: 0,
          averageCost: 0 as never,
        });

    const available = calculateAvailable(derivedInventory);
    const projected = calculateProjected(derivedInventory);
    const averageCost = product.hasVariants ? 0 : Number(productBalance?.averageCost ?? 0);

    return {
      ...product,
      stock: derivedInventory.onHand,
      onHand: derivedInventory.onHand,
      reserved: derivedInventory.reserved,
      available,
      incoming: derivedInventory.incoming,
      projected,
      averageCost,
      inventoryValue: Number((derivedInventory.onHand * averageCost).toFixed(4)),
      variants: mappedVariants,
    };
  });
}

export async function listProducts(contaId: string, opts: ProductListOptions = {}) {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize || 50));
  const where: Record<string, unknown> = {
    contaId,
    archivedAt: opts.archived ? { not: null } : null,
  };
  if (opts.q) {
    where.OR = [
      { name: { contains: opts.q, mode: 'insensitive' } },
      { sku: { contains: opts.q, mode: 'insensitive' } },
    ];
  }
  if (opts.categoryId) where.categoryId = opts.categoryId;
  if (opts.activeOnly) where.isActive = true;

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: true,
        images: { where: { isPrimary: true }, take: 1, select: { url: true } },
        variants: {
          select: {
            id: true,
            title: true,
            sku: true,
            price: true,
            stock: true,
            lowStockThreshold: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  const balances = await listInventoryBalanceRows(
    contaId,
    data.map((product) => product.id),
  );

  return { data: mapProductsWithInventory(data, balances), page, pageSize, total };
}

export async function toggleProductActive(id: string, contaId: string, isActive: boolean) {
  const current = await prisma.product.findFirst({ where: { id, contaId, archivedAt: null } });
  if (!current) throw new Error('Produto não encontrado');

  await prisma.product.updateMany({
    where: { id, contaId },
    data: { isActive },
  });

  const updated = await prisma.product.findFirst({
    where: { id, contaId },
    include: { category: true },
  });
  if (!updated) throw new Error('Produto não encontrado após atualização');
  return updated;
}

export async function archiveProduct(id: string, contaId: string) {
  const current = await prisma.product.findFirst({ where: { id, contaId, archivedAt: null } });
  if (!current) throw new Error('Produto não encontrado');

  await prisma.product.updateMany({
    where: { id, contaId },
    data: { archivedAt: new Date() },
  });

  const updated = await prisma.product.findFirst({ where: { id, contaId } });
  if (!updated) throw new Error('Produto não encontrado após arquivamento');
  return updated;
}

export async function deleteProduct(id: string, contaId: string): Promise<void> {
  const current = await prisma.product.findFirst({ where: { id, contaId } });
  if (!current) throw new Error('Produto não encontrado');

  await prisma.product.delete({
    where: { id },
  });
}

export async function unarchiveProduct(id: string, contaId: string) {
  const current = await prisma.product.findFirst({
    where: { id, contaId, archivedAt: { not: null } },
  });
  if (!current) throw new Error('Produto não encontrado ou já está ativo');

  await prisma.product.updateMany({
    where: { id, contaId },
    data: { archivedAt: null },
  });

  const updated = await prisma.product.findFirst({
    where: { id, contaId },
    include: { category: true },
  });
  if (!updated) throw new Error('Produto não encontrado após restauração');
  return updated;
}

export async function getProduct(id: string, contaId: string) {
  const product = await prisma.product.findFirst({
    where: { id, contaId },
    include: {
      category: true,
      images: { where: { isPrimary: true }, take: 1, select: { url: true } },
      variants: {
        select: {
          id: true,
          title: true,
          sku: true,
          price: true,
          stock: true,
          lowStockThreshold: true,
          isActive: true,
        },
      },
    },
  });

  if (!product) return null;

  const balances = await listInventoryBalanceRows(contaId, [product.id]);
  const [mapped] = mapProductsWithInventory([product], balances);
  return mapped;
}
