import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency, formatDate } from '../lib/utils';

interface UnpaidRow {
  deduction_id: string;
  contract_id: string;
  contract_number: number;
  lessee_name: string;
  distributor_name: string;
  partner_name: string | null;
  execution_date: string | null;
  expiry_date: string | null;
  due_date: string;
  amount: number;
  paid_amount: number;
  owed: number;
  sms_sent: boolean;
  call_made: boolean;
  credit_agency_sent: boolean;
  criminal_complaint: boolean;
  delayed_recovery: boolean;
}

const ACTION_BADGES: { key: keyof UnpaidRow; label: string; color: string }[] = [
  { key: 'sms_sent', label: '문자', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { key: 'call_made', label: '전화', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  { key: 'credit_agency_sent', label: '신정사', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { key: 'criminal_complaint', label: '고소', color: 'bg-red-500/20 text-red-300 border-red-500/40' },
  { key: 'delayed_recovery', label: '지연회수', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
];

interface Props {
  fromDate: string;
  toDate: string;
  label: string;
  execFrom?: string;
  execTo?: string;
  anchorDate?: string;
  onClose: () => void;
  onProcessed: () => void;
}

export const UnpaidDetailPanel: React.FC<Props> = ({ fromDate, toDate, label, execFrom, execTo, anchorDate, onClose, onProcessed }) => {
  const [rows, setRows] = useState<UnpaidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payEditing, setPayEditing] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [visibleCount, setVisibleCount] = useState(200);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const args: any = { from_date: fromDate, to_date: toDate };
        if (execFrom) args.exec_from = execFrom;
        if (execTo) args.exec_to = execTo;
        // RPC로 서버사이드 JOIN + 1000건 제한 우회
        const { data, error } = await (supabase!.rpc as any)('get_unpaid_details', args);
        if (error) throw error;
        if (cancelled) return;
        setRows(((data || []) as any[]).map(r => ({
          deduction_id: r.deduction_id,
          contract_id: r.contract_id,
          contract_number: Number(r.contract_number) || 0,
          lessee_name: r.lessee_name || '',
          distributor_name: r.distributor_name || '',
          partner_name: r.partner_name || null,
          execution_date: r.execution_date || null,
          expiry_date: r.expiry_date || null,
          due_date: r.due_date,
          amount: Number(r.amount) || 0,
          paid_amount: Number(r.paid_amount) || 0,
          owed: Number(r.owed) || 0,
          sms_sent: !!r.sms_sent,
          call_made: !!r.call_made,
          credit_agency_sent: !!r.credit_agency_sent,
          criminal_complaint: !!r.criminal_complaint,
          delayed_recovery: !!r.delayed_recovery,
        })));
      } catch (e: any) {
        console.error('미납 상세 로드 실패:', e);
        alert(`미납 상세 로드 실패: ${e.message}\n\n(RPC 함수 get_unpaid_details 가 DB에 없을 수 있어요. sql_unpaid_details_rpc.sql 파일을 Supabase SQL Editor에서 실행해주세요.)`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [fromDate, toDate, execFrom, execTo]);

  const handlePay = async (row: UnpaidRow) => {
    if (!supabase) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { alert('금액을 입력해주세요.'); return; }
    if (amount > row.owed * 1.01) {
      if (!confirm(`입금액(${formatCurrency(amount)})이 미납액(${formatCurrency(row.owed)})보다 큽니다.\n그래도 처리할까요? (초과분은 무시됩니다)`)) return;
    }
    setPaying(true);
    try {
      const pay = Math.min(amount, row.owed);
      const newPaid = row.paid_amount + pay;
      const newStatus = newPaid >= row.amount ? '납부완료' : '부분납부';
      const { error: e1 } = await (supabase.from('daily_deductions') as any)
        .update({ paid_amount: newPaid, status: newStatus })
        .eq('id', row.deduction_id);
      if (e1) throw e1;

      const today = new Date().toISOString().split('T')[0];
      await (supabase.from('bank_deposits') as any).insert({
        deposit_date: today,
        depositor_name: `${row.lessee_name} (대시보드 수동처리)`,
        amount: pay,
        salesperson_id: null,
        status: 'matched',
        matched_amount: pay,
        remaining_amount: 0,
        processed_at: new Date().toISOString(),
        memo: `대시보드 - #${row.contract_number} ${row.due_date} 미수 처리`,
      });

      setRows(prev => prev.filter(r => r.deduction_id !== row.deduction_id));
      setPayEditing(null);
      setPayAmount('');
      onProcessed();
    } catch (e: any) {
      alert(`처리 실패: ${e.message}`);
    } finally {
      setPaying(false);
    }
  };

  const totalOwed = useMemo(() => rows.reduce((s, r) => s + r.owed, 0), [rows]);

  // 검색 필터 (계약자/총판/파트너/계약번호)
  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const kw = filter.trim().toLowerCase();
    return rows.filter(r =>
      r.lessee_name.toLowerCase().includes(kw) ||
      r.distributor_name.toLowerCase().includes(kw) ||
      (r.partner_name || '').toLowerCase().includes(kw) ||
      String(r.contract_number).includes(kw)
    );
  }, [rows, filter]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  return (
    <div className="mt-4 bg-slate-800/80 rounded-lg p-4 border border-red-700/40">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h4 className="text-sm font-semibold text-red-300">🔍 미납 상세: {label}</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            {fromDate === toDate ? fromDate : `${fromDate} ~ ${toDate}`} · {rows.length}건 · 총 <span className="text-red-400 font-semibold">{formatCurrency(totalOwed)}</span>
            {filter && <span className="text-slate-400"> · 검색 결과 {filtered.length}건</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="계약자/총판/파트너 검색..."
              className="bg-slate-700 text-white text-xs rounded px-2 py-1 w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          )}
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-white bg-slate-700 px-2 py-1 rounded">✕ 닫기</button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-red-500" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-4">미납 건이 없습니다. ✅</p>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-800 z-10">
              <tr className="text-slate-400 border-b border-slate-700">
                <th className="p-2 text-left">날짜</th>
                <th className="p-2 text-left">계약자</th>
                <th className="p-2 text-left">총판</th>
                <th className="p-2 text-left">파트너사</th>
                <th className="p-2 text-right">미납액</th>
                <th className="p-2 text-center">처리</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.deduction_id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="p-2 text-slate-300 whitespace-nowrap">{formatDate(r.due_date)}</td>
                  <td className="p-2 text-white">
                    <div>
                      {r.lessee_name}
                      <span className="text-slate-500 text-xs ml-1">#{r.contract_number}</span>
                    </div>
                    {(r.execution_date || r.expiry_date) && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {r.execution_date ? formatDate(r.execution_date) : '?'} ~ {r.expiry_date ? formatDate(r.expiry_date) : '?'}
                      </div>
                    )}
                    {(() => {
                      const active = ACTION_BADGES.filter(a => r[a.key]);
                      if (active.length === 0) {
                        return <div className="text-[10px] text-slate-600 mt-1">조치 없음</div>;
                      }
                      return (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {active.map(a => (
                            <span key={a.key as string}
                              className={`text-[10px] px-1.5 py-0 rounded border ${a.color}`}>
                              {a.label}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-2 text-slate-300">{r.distributor_name}</td>
                  <td className="p-2 text-slate-400 text-xs">{r.partner_name || '-'}</td>
                  <td className="p-2 text-right text-red-400 font-semibold whitespace-nowrap">{formatCurrency(r.owed)}</td>
                  <td className="p-2 text-center">
                    {payEditing === r.deduction_id ? (
                      <div className="flex items-center gap-1 justify-end">
                        <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                          placeholder="금액"
                          className="bg-slate-700 text-white text-xs rounded px-2 py-1 w-24 focus:outline-none focus:ring-1 focus:ring-green-500"
                          autoFocus />
                        <button onClick={() => handlePay(r)} disabled={paying}
                          className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-2 py-1 rounded">
                          {paying ? '...' : '처리'}
                        </button>
                        <button onClick={() => { setPayEditing(null); setPayAmount(''); }}
                          className="text-xs text-slate-400 hover:text-white px-1">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setPayEditing(r.deduction_id); setPayAmount(String(r.owed)); }}
                        className="text-xs bg-green-600/20 text-green-300 border border-green-500/40 hover:bg-green-600/30 px-2 py-0.5 rounded">
                        💰 입금
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className="flex justify-center py-2">
              <button onClick={() => setVisibleCount(c => c + 200)}
                className="text-xs text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded">
                더 보기 ({filtered.length - visibleCount}건 남음)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
