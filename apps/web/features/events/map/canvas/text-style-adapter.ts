import { getTextDecorationValue } from '@alusa/domain';

export function getKonvaTextDecoration(data: Record<string, unknown>): string | undefined {
  return getTextDecorationValue(data);
}
