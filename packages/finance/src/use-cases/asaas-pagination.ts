/** Validates the completeness contract returned by Asaas paginated lists. */
export function assertCompleteAsaasPage<T>(
  response: { data: T[]; hasMore: boolean; totalCount: number; offset: number; limit: number },
  expectedOffset: number,
  expectedLimit: number,
  expectedTotalCount?: number,
): number {
  if (
    !response ||
    !Array.isArray(response.data) ||
    !Number.isInteger(response.totalCount) ||
    response.totalCount < 0 ||
    typeof response.hasMore !== 'boolean' ||
    response.offset !== expectedOffset ||
    response.limit !== expectedLimit
  ) throw new Error('ASAAS_LIST_INCOMPLETE:INVALID_PAGE');
  if (expectedTotalCount !== undefined && response.totalCount !== expectedTotalCount) {
    throw new Error('ASAAS_LIST_INCOMPLETE:TOTAL_COUNT_CHANGED');
  }
  if (response.hasMore && response.data.length !== expectedLimit) {
    throw new Error('ASAAS_LIST_INCOMPLETE:SHORT_PAGE_WITH_MORE');
  }

  const collected = expectedOffset + response.data.length;
  if (
    collected > response.totalCount ||
    response.hasMore === (collected >= response.totalCount)
  ) throw new Error('ASAAS_LIST_INCOMPLETE:TOTAL_COUNT_MISMATCH');

  return response.totalCount;
}
