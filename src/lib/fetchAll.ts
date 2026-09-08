/**
 * Fetch every row of a filtered query instead of silently stopping at the
 * first page. Supabase caps a single request at 1000 rows, so long date
 * ranges used to drop older records without any warning.
 *
 * Pass a factory that rebuilds the same query for each page — a Supabase
 * builder can only be awaited once.
 */
const PAGE = 1000;

export async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: any; error: any }>,
  maxRows = 20000,
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < maxRows; start += PAGE) {
    const { data, error } = await makeQuery(start, start + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
