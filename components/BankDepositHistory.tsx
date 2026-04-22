import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Salesperson } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';

interface Props {
  salespeople: Salesperson[];
  onReverted: () => void;
}

interface DepositRow {
  id: string;
  deposit_date: string;
  depositor_name: string;
  amount: number;
  salesperson_id: string | null;
  status: string;
  matched_amount: number;
  remaining_amount: number;
  uploaded_at: string;
  processed_at: string | null;
  reverted_at: string | null;
  batch_id: string | null;
  contract_changes: any;
}

export const BankDepositHistory: React.FC<Props> = ({ salespeople, onReverted }) => {
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<string | null>(null);

  const spById = useMemo(() => new Map(salespeople.map(s => [s.id, s.name])), [salespeople]);

  const fetchDeposits = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data } = await (supabase.from('bank_deposits') as any).select('*').order('uploaded_at', { ascending: false }).limit(200);
    setDeposits(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchDeposits(); }, []);

  // batch_id로 그룹핑
  const batches = useMemo(() => {
    const map = new Map<string, DepositRow[]>();
    for (const d of deposits) {
      const key = d.batch_id || `single_${d.id}`;
      const arr = map.get(key) || [];
      arr.push(d);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([batchId, rows]) => ({
      batchId,
      rows,
      uploadedAt: rows[0].uploaded_at,
      revertedAt: rows[0].reverted_at,
      totalAmount: rows.reduce((s, r) => s + Number(r.amount), 0),
      matchedCount: rows.filter(r => r.salesperson_id).length,
      unmatchedCount: rows.filter(r => !r.salesperson_id).length,
      contractChanges: rows.find(r => r.contract_changes)?.contract_changes,
    })).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [deposits]);

  const handleRevert = async (batch: typeof batches[0]) => {
    if (!supabase) return;
    if (!confirm(`이 일괄 처리를 취소하시겠습니까?\n${batch.rows.length}건 입금 + 계약 ${batch.contractChanges?.length || 0}건 원복됩니다.`)) return;

    setReverting(batch.batchId);
    try {
      // 1) 계약 daily_deductions 원복
      if (batch.contractChanges && Array.isArray(batch.contractChanges)) {
        for (const cc of batch.contractChanges) {
          await (supabase.from('contracts') as any).update({ daily_deductions: cc.before_deductions }).eq('id', cc.contract_id);
        }
      }
      // 2) 입금 기록을 reverted 표시 (삭제 대신 이력 보존)
      const ids = batch.rows.map(r => r.id);
      await (supabase.from('bank_deposits') as any).update({ reverted_at: new Date().toISOString() }).in('id', ids);

      alert('일괄 처리 취소 완료');
      await fetchDeposits();
      onReverted();
    } catch (e: any) {
      alert(`취소 실패: ${e.message}`);
    } finally {
      setReverting(null);
    }
  };

  if (loading) return <p className="text-slate-400">불러오는 중...</p>;

  return (
    <div className="space-y-3">
      <h3 className="text-white font-bold">은행 입금 이력 (최근 200건)</h3>
      {batches.length === 0 ? (
        <p className="text-slate-400 text-sm">아직 처리된 입금이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {batches.map(b => (
            <div key={b.batchId} className={`bg-slate-800 rounded-lg border p-4 ${b.revertedAt ? 'border-red-500/30 opacity-60' : 'border-slate-700'}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium">
                      {new Date(b.uploadedAt).toLocaleString('ko-KR')}
                    </span>
                    <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">
                      {b.rows.length}건 · {formatCurrency(b.totalAmount)}
                    </span>
                    {b.revertedAt && (
                      <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded">
                        취소됨 ({new Date(b.revertedAt).toLocaleDateString('ko-KR')})
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    매칭 {b.matchedCount}건 / 미매칭 {b.unmatchedCount}건 / 계약 변경 {b.contractChanges?.length || 0}건
                  </p>
                </div>
                {!b.revertedAt && b.contractChanges && (
                  <button onClick={() => handleRevert(b)} disabled={reverting === b.batchId}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded">
                    {reverting === b.batchId ? '취소 중...' : '일괄 취소'}
                  </button>
                )}
              </div>

              {/* 상세 입금 내역 */}
              <details className="mt-3">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">상세 보기</summary>
                <div className="mt-2 max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-400">
                      <tr><th className="p-1 text-left">날짜</th><th className="p-1 text-left">입금자</th><th className="p-1 text-right">금액</th><th className="p-1 text-left">영업자</th><th className="p-1 text-center">상태</th></tr>
                    </thead>
                    <tbody>
                      {b.rows.map(r => (
                        <tr key={r.id} className="border-t border-slate-700/50">
                          <td className="p-1 text-slate-300">{r.deposit_date}</td>
                          <td className="p-1 text-white">{r.depositor_name}</td>
                          <td className="p-1 text-right text-slate-200">{formatCurrency(Number(r.amount))}</td>
                          <td className="p-1 text-slate-300">{r.salesperson_id ? spById.get(r.salesperson_id) || '?' : <span className="text-red-400">미매칭</span>}</td>
                          <td className="p-1 text-center text-xs">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
