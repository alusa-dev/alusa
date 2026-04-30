import { prisma } from '../prisma';
import { categorySchema } from '../schemas/category.schema';
import type { ProductCategory } from '@prisma/client';

export async function createCategory(input: {
  contaId: string;
  name: string;
}): Promise<ProductCategory> {
  const parsed = categorySchema.parse({ name: input.name?.trim() });

  const exists = await prisma.productCategory.findFirst({
    where: { contaId: input.contaId, name: parsed.name },
  });
  if (exists) throw new Error('Já existe uma categoria com este nome');

  return prisma.productCategory.create({
    data: { contaId: input.contaId, name: parsed.name },
  });
}

export async function listCategories(contaId: string): Promise<ProductCategory[]> {
  return prisma.productCategory.findMany({
    where: { contaId },
    orderBy: { name: 'asc' },
  });
}

export async function deleteCategory(id: string, contaId: string): Promise<void> {
  const current = await prisma.productCategory.findFirst({ where: { id, contaId } });
  if (!current) throw new Error('Categoria não encontrada');

  const productsCount = await prisma.product.count({
    where: { categoryId: id, contaId, archivedAt: null },
  });
  if (productsCount > 0) {
    throw new Error('Não é possível excluir categoria com produtos ativos vinculados');
  }

  await prisma.productCategory.deleteMany({ where: { id, contaId } });
}
