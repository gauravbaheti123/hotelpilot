/**
 * Report reads must never stop at PostgREST's 1000-row page. Every report
 * list/aggregate goes through these helpers so a long date range loads all
 * rows instead of silently truncating totals.
 */
import { fetchAllRows } from "@/lib/fetchAll";
import { reportQueryError } from "@/lib/queryError";

/** Run a paged select. Errors are surfaced (toast + console) and yield []. */
export async function pagedSelect<T = any>(
  label: string,
  makeQuery: (from: number, to: number) => PromiseLike<{ data: any; error: any }>,
  maxRows = 50000,
): Promise<T[]> {
  try {
    return await fetchAllRows<T>(makeQuery, maxRows);
  } catch (e) {
    reportQueryError(label, e);
    return [];
  }
}

/** Chunk a long id list so the request URL stays valid, paging each chunk. */
export async function pagedIn<T = any>(
  label: string,
  ids: string[],
  makeQuery: (chunk: string[], from: number, to: number) => PromiseLike<{ data: any; error: any }>,
  chunkSize = 200,
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    out.push(...(await pagedSelect<T>(label, (f, t) => makeQuery(chunk, f, t))));
  }
  return out;
}
