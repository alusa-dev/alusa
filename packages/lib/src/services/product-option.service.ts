import { prisma } from '../prisma';
import type { ProductOption, ProductOptionValue } from '@prisma/client';

export type ProductOptionWithValues = ProductOption & { values: ProductOptionValue[] };

export async function listProductOptions(
  productId: string,
  contaId: string,
): Promise<ProductOptionWithValues[]> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  return prisma.productOption.findMany({
    where: { productId },
    include: { values: { orderBy: [{ sortOrder: 'asc' }] } },
    orderBy: [{ sortOrder: 'asc' }],
  });
}

export async function createProductOption(input: {
  productId: string;
  contaId: string;
  name: string;
}): Promise<ProductOptionWithValues> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, contaId: input.contaId },
  });
  if (!product) throw new Error('Produto não encontrado');

  const name = input.name.trim();
  if (!name) throw new Error('Nome da opção é obrigatório');
  if (name.length > 50) throw new Error('Nome da opção muito longo (máx. 50 caracteres)');

  const count = await prisma.productOption.count({ where: { productId: input.productId } });

  const option = await prisma.productOption.create({
    data: { productId: input.productId, name, sortOrder: count },
    include: { values: true },
  });

  return option;
}

export async function deleteProductOption(
  optionId: string,
  productId: string,
  contaId: string,
): Promise<void> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  const option = await prisma.productOption.findFirst({ where: { id: optionId, productId } });
  if (!option) throw new Error('Opção não encontrada');

  await prisma.productOption.delete({ where: { id: optionId } });
}

export async function addOptionValue(input: {
  optionId: string;
  productId: string;
  contaId: string;
  value: string;
}): Promise<ProductOptionValue> {
  const product = await prisma.product.findFirst({
    where: { id: input.productId, contaId: input.contaId },
  });
  if (!product) throw new Error('Produto não encontrado');

  const option = await prisma.productOption.findFirst({
    where: { id: input.optionId, productId: input.productId },
  });
  if (!option) throw new Error('Opção não encontrada');

  const value = input.value.trim();
  if (!value) throw new Error('Valor da opção é obrigatório');
  if (value.length > 100) throw new Error('Valor muito longo (máx. 100 caracteres)');

  const count = await prisma.productOptionValue.count({ where: { optionId: input.optionId } });

  return prisma.productOptionValue.create({
    data: { optionId: input.optionId, value, sortOrder: count },
  });
}

export async function deleteOptionValue(
  valueId: string,
  optionId: string,
  productId: string,
  contaId: string,
): Promise<void> {
  const product = await prisma.product.findFirst({ where: { id: productId, contaId } });
  if (!product) throw new Error('Produto não encontrado');

  const value = await prisma.productOptionValue.findFirst({
    where: { id: valueId, optionId },
    include: { option: true },
  });
  if (!value || value.option.productId !== productId) throw new Error('Valor não encontrado');

  await prisma.productOptionValue.delete({ where: { id: valueId } });
}
