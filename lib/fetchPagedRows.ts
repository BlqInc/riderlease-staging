import { supabase } from './supabaseClient';

/**
 * Supabase의 1000건 기본 제한을 우회하여 테이블/뷰의 모든 행을 페이지네이션으로 가져옴.
 * 마지막 페이지가 pageSize보다 작으면 종료. 무한 루프 방지 위해 max 페이지 수 제한 있음.
 *
 * 사용 예:
 *   const all = await fetchPagedRows<Contract>('contracts_summary_light', '*', q =>
 *     q.order('contract_number', { ascending: false })
 *   );
 */
export async function fetchPagedRows<T = any>(
  tableName: string,
  select: string = '*',
  applyQuery?: (q: any) => any,
  pageSize: number = 1000,
  maxPages: number = 100,
): Promise<T[]> {
  if (!supabase) return [];
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    let q = (supabase.from(tableName) as any).select(select).range(from, to);
    if (applyQuery) q = applyQuery(q);
    const { data, error } = await q;
    if (error) throw error;
    const batch = (data || []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) break;  // 마지막 페이지
  }
  return rows;
}
