/**
 * Utility helpers for CDS query operations.
 */

/**
 * Extract count value from CDS query result.
 * Handles various result formats including arrays and single objects.
 * Safely parses string counts to numbers.
 */
export const extractCount = (result: unknown): number => {
  if (Array.isArray(result) && result.length > 0) {
    const row = result[0] as { count?: number | string };
    return typeof row.count === 'number' ? row.count : parseInt(String(row.count || '0'), 10);
  }
  const row = result as { count?: number | string } | undefined;
  return typeof row?.count === 'number' ? row.count : parseInt(String(row?.count || '0'), 10);
};
