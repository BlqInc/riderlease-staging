import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onReverted: () => void;
}

interface Row {
  batch_id: string | null;
  deposit_date: string;
  amount: number;
  salesperson_id: string | null;
  uploaded_at: string;
}

interface Batch {
  batch_id: string | null;
  count: number;
  total: number;
  matched: number;
  dateFrom: string;
  dateTo: string;
  uploadedAt: string;
}

function formatKST(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export const DailyDepositHistory: React.FC<Props> = ({ open, onClose, onReverted }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase.from('daily_bank_deposits') as any)
        .select('batch_id, deposit_date, amount, salesperson_id, uploaded_at')
        .is('reverted_at', null)
        .order('uploaded_at', { ascending: false })
        .limit(5000);
      if (error) throw error;
      setRows((data || []) as Row[]);
    } catch (e: any) {
      alert('이력 로드 실패: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); }, [open]);

  // batch_id 별 집계
  const batches = useMemo<Batch[]>(() => {
    const map = new Map<string, Batch>();
    for (const r of rows) {
      const key = r.batch_id || '__no_batch__';
      let b = map.get(key);
      if (!b) {
        b = {
          batch_id: r.batch_id,
          count: 0,
          total: 0,
          matched: 0,
          dateFrom: r.deposit_date,
          dateTo: r.deposit_date,
          uploadedAt: r.uploaded_at,
        };
        map.set(key, b);
      }
      b.count += 1;
      b.total += Number(r.amount) || 0;
      if (r.salesperson_id) b.matched += 1;
      if (r.deposit_date < b.dateFrom) b.dateFrom = r.deposit_date;
      if (r.deposit_date > b.dateTo) b.dateTo = r.deposit_date;
      // uploaded_at는 같은 batch 안에서 동일 가정. 약간 차이 있어도 첫 값으로.
      if (!b.uploadedAt || r.uploaded_at < b.uploadedAt) b.uploadedAt = r.uploaded_at;
    }
    return Array.from(map.values()).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  }, [rows]);

  const handleRevert = async (batch: Batch) => {
    if (!supabase || reverting) return;
    if (!batch.batch_id) { alert('batch_id가 없는 이전 데이터는 롤백 불가. SQL로 직접 처리하세요.'); return; }
    if (!confirm(
      `[${formatKST(batch.uploadedAt)}] 업로드를 롤백할까요?\n\n` +
      `기간: ${batch.dateFrom} ~ ${batch.dateTo}\n` +
      `건수: ${batch.count}건\n` +
      `총액: ₩${formatCurrency(batch.total)}\n\n` +
      `※ 해당 batch의 모든 행에 reverted_at이 기록되어\n   일별 회수 현황에서 즉시 제외됩니다 (행 자체는 보존).`
    )) return;

    setReverting(batch.batch_id);
    try {
      const { error } = await (supabase.from('daily_bank_deposits') as any)
        .update({ reverted_at: new Date().toISOString() })
        .eq('batch_id', batch.batch_id)
        .is('reverted_at', null);
      if (error) throw error;
      alert(`${batch.count}건 롤백 완료`);
      await load();
      onReverted();
    } catch (e: any) {
      alert('롤백 실패: ' + e.message);
    } finally {
      setReverting(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[820px] max-w-[95vw] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-white font-semibold text-lg">업로드 이력 & 롤백</h3>
            <p className="text-xs text-slate-400 mt-1">
              일별 회수 현황에 들어간 입금 batch 목록. 롤백하면 그 batch의 모든 행이 자동으로 화면에서 제외됩니다 (soft delete).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-xs text-slate-400 hover:text-white">↻ 새로고침</button>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-slate-400 py-6 text-sm">로딩 중...</div>
        ) : batches.length === 0 ? (
          <div className="text-center text-slate-500 py-6 text-sm">업로드 이력이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-700/50">
                <tr className="text-slate-400">
                  <th className="p-2 text-left">업로드 시각</th>
                  <th className="p-2 text-left">기간</th>
                  <th className="p-2 text-right">건수</th>
                  <th className="p-2 text-right">총액</th>
                  <th className="p-2 text-center">영업자 매칭</th>
                  <th className="p-2 text-center">액션</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.batch_id || 'no_batch'} className="border-t border-slate-700/50 hover:bg-slate-700/30">
                    <td className="p-2 text-slate-300 whitespace-nowrap">{formatKST(b.uploadedAt)}</td>
                    <td className="p-2 text-slate-400 text-xs">{b.dateFrom} ~ {b.dateTo}</td>
                    <td className="p-2 text-right text-white">{b.count}건</td>
                    <td className="p-2 text-right text-emerald-400">₩{formatCurrency(b.total)}</td>
                    <td className="p-2 text-center text-xs text-slate-300">{b.matched} / {b.count}</td>
                    <td className="p-2 text-center">
                      {b.batch_id ? (
                        <button onClick={() => handleRevert(b)} disabled={reverting === b.batch_id}
                          className="text-[10px] bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/50 px-2 py-1 rounded disabled:opacity-50">
                          {reverting === b.batch_id ? '롤백 중...' : '🔙 롤백'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500">batch 없음</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
