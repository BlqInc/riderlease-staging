import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Contract } from '../types';
import { supabase } from '../lib/supabaseClient';
import { fetchPagedRows } from '../lib/fetchPagedRows';
import { formatCurrency } from '../lib/utils';
import { DailyDepositUpload } from './DailyDepositUpload';

interface Props {
  contracts: Contract[];
}

interface BankDepositRow {
  id: string;
  deposit_date: string;
  depositor_name: string | null;
  amount: number;
  salesperson_id: string | null;
}

interface DailyRow {
  date: string;
  receivable: number;  // 받아야 할
  received: number;    // 실제 들어온
  diff: number;        // 들어온 - 받아야 할 (음수=미수, 양수=과입금)
}

// ─── 헬퍼 ───
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

function eachDateInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

export const DailyFinanceReport: React.FC<Props> = ({ contracts }) => {
  const [range, setRange] = useState(defaultRange);
  const [appliedRange, setAppliedRange] = useState(defaultRange);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // contracts.daily_deductions가 비어있을 수 있어 별도 보관
  const [ddByContract, setDdByContract] = useState<Map<string, any[]>>(new Map());
  const [ddLoaded, setDdLoaded] = useState(false);
  const [deposits, setDeposits] = useState<BankDepositRow[]>([]);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [salespeopleMap, setSalespeopleMap] = useState<Map<string, string>>(new Map());
  const [salespeople, setSalespeople] = useState<any[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  // 1) daily_deductions 페이지네이션 로드 (페이지 진입 시 1회)
  useEffect(() => {
    if (ddLoaded) return;
    (async () => {
      setLoading(true);
      try {
        const all = await fetchPagedRows<any>('contracts', 'id, daily_deductions');
        const map = new Map<string, any[]>();
        all.forEach((c: any) => map.set(c.id, Array.isArray(c.daily_deductions) ? c.daily_deductions : []));
        setDdByContract(map);
        setDdLoaded(true);
        // 영업자 매핑도 같이 (드릴다운 표시용 + 업로드 모달의 자동매칭용)
        if (supabase) {
          const { data: sp } = await (supabase.from('salespeople') as any).select('id, name, bank_aliases');
          const spList = (sp || []) as any[];
          setSalespeople(spList);
          const spMap = new Map<string, string>();
          spList.forEach((s: any) => spMap.set(s.id, s.name));
          setSalespeopleMap(spMap);
        }
      } catch (e: any) {
        setError('daily_deductions 로드 실패: ' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [ddLoaded]);

  // 2) 기간 적용 시 daily_bank_deposits 조회 (회수관리 bank_deposits와 완전 분리)
  const reloadDeposits = useCallback(async (from: string, to: string) => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: depErr } = await (supabase.from('daily_bank_deposits') as any)
        .select('id, deposit_date, depositor_name, amount, salesperson_id')
        .gte('deposit_date', from).lte('deposit_date', to);
      if (depErr) throw depErr;
      setDeposits((data || []) as BankDepositRow[]);
    } catch (e: any) {
      setError('daily_bank_deposits 조회 실패: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadDeposits(appliedRange.from, appliedRange.to);
  }, [appliedRange.from, appliedRange.to, reloadDeposits]);

  // 3) 일자별 집계 (받아야 할 / 들어온 / 차액)
  const dailyRows = useMemo<DailyRow[]>(() => {
    if (!ddLoaded) return [];
    const { from, to } = appliedRange;
    if (!from || !to || from > to) return [];

    // 받아야 할: contracts의 daily_deductions[date].amount 합
    const receivableByDate = new Map<string, number>();
    for (const c of contracts) {
      const dds = ddByContract.get(c.id) || [];
      for (const dd of dds) {
        if (!dd?.date) continue;
        if (dd.date < from || dd.date > to) continue;
        const amt = Number(dd.amount) || 0;
        receivableByDate.set(dd.date, (receivableByDate.get(dd.date) || 0) + amt);
      }
    }
    // 들어온: bank_deposits.amount 합
    const receivedByDate = new Map<string, number>();
    for (const d of deposits) {
      if (!d.deposit_date) continue;
      receivedByDate.set(d.deposit_date, (receivedByDate.get(d.deposit_date) || 0) + (Number(d.amount) || 0));
    }
    // 기간 내 모든 일자 행 생성 (둘 다 0이면 제외)
    const rows: DailyRow[] = [];
    const dates = eachDateInRange(from, to);
    for (const date of dates) {
      const receivable = receivableByDate.get(date) || 0;
      const received = receivedByDate.get(date) || 0;
      if (receivable === 0 && received === 0) continue;
      rows.push({ date, receivable, received, diff: received - receivable });
    }
    // 최근 일자가 위
    rows.sort((a, b) => a.date < b.date ? 1 : -1);
    return rows;
  }, [ddLoaded, ddByContract, contracts, deposits, appliedRange]);

  // 4) KPI 합계
  const kpi = useMemo(() => {
    const totalReceivable = dailyRows.reduce((s, r) => s + r.receivable, 0);
    const totalReceived = dailyRows.reduce((s, r) => s + r.received, 0);
    const totalUnpaid = totalReceivable - totalReceived;  // 단순 차이
    return { totalReceivable, totalReceived, totalUnpaid };
  }, [dailyRows]);

  // 5) 드릴다운 데이터: 그 일자의 raw 내역
  const drilldown = useMemo(() => {
    if (!expandedDate) return null;
    // 들어온 raw
    const incoming = deposits.filter(d => d.deposit_date === expandedDate);
    // 받아야 할 raw (그 일자 차감 있는 계약)
    const receivable: { contract_number: number; lessee_name: string; distributor_name: string; salesperson_name: string; amount: number }[] = [];
    // 계약→영업자 매핑은 컴포넌트 prop 한계로 그 일자 deposits.salesperson_id 사용. 좀 더 정확하려면 salesperson_partners 필요. 단순화: 빈칸.
    for (const c of contracts) {
      const dds = ddByContract.get(c.id) || [];
      const dd = dds.find((x: any) => x?.date === expandedDate);
      if (!dd) continue;
      const amt = Number(dd.amount) || 0;
      if (amt === 0) continue;
      receivable.push({
        contract_number: Number(c.contract_number) || 0,
        lessee_name: c.lessee_name || '',
        distributor_name: c.distributor_name || '',
        salesperson_name: '',  // partner_id로 역추적 필요 — 추후
        amount: amt,
      });
    }
    receivable.sort((a, b) => a.contract_number - b.contract_number);
    return { incoming, receivable };
  }, [expandedDate, deposits, contracts, ddByContract]);

  // 6) 엑셀 다운로드
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    if (exporting || dailyRows.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx-js-style');
      // Sheet 1: 일자별 집계
      const summaryRows: any[][] = [
        [`기간: ${appliedRange.from} ~ ${appliedRange.to}`, '일별 회수 현황 (현금주의)'],
        ['일자', '받아야 할', '들어온', '차액', '구분'],
        ...dailyRows.map(r => [r.date, r.receivable, r.received, r.diff, r.diff < 0 ? '미수' : r.diff > 0 ? '과입금' : '일치']),
        [],
        ['합계', kpi.totalReceivable, kpi.totalReceived, kpi.totalReceived - kpi.totalReceivable, kpi.totalUnpaid > 0 ? '미수' : '완납'],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
      const headerStyle = {
        fill: { fgColor: { rgb: '4472C4' } },
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center' },
        border: { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      };
      for (let c = 0; c < 5; c++) {
        const addr = XLSX.utils.encode_cell({ r: 1, c });
        if (ws1[addr]) ws1[addr].s = headerStyle;
      }
      // 숫자 콤마
      for (let r = 2; r < summaryRows.length; r++) {
        for (const c of [1, 2, 3]) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws1[addr] && typeof ws1[addr].v === 'number') ws1[addr].z = '#,##0';
        }
      }
      ws1['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, '일별 집계');

      // Sheet 2: 들어온 raw
      const incomingRaw: any[][] = [
        ['일별 입금 내역 (bank_deposits)'],
        ['일자', '영업자', '입금자명', '금액'],
        ...deposits
          .slice()
          .sort((a, b) => (a.deposit_date < b.deposit_date ? -1 : 1))
          .map(d => [
            d.deposit_date,
            d.salesperson_id ? (salespeopleMap.get(d.salesperson_id) || '?') : '(매칭 안됨)',
            d.depositor_name || '',
            Number(d.amount) || 0,
          ]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(incomingRaw);
      for (let c = 0; c < 4; c++) {
        const addr = XLSX.utils.encode_cell({ r: 1, c });
        if (ws2[addr]) ws2[addr].s = headerStyle;
      }
      for (let r = 2; r < incomingRaw.length; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: 3 });
        if (ws2[addr]) ws2[addr].z = '#,##0';
      }
      ws2['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, '들어온 raw');

      const fname = `일별회수현황_${appliedRange.from.replace(/-/g,'')}-${appliedRange.to.replace(/-/g,'')}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch (e: any) {
      alert('엑셀 생성 실패: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-bold text-white">일별 회수 현황 <span className="text-sm font-normal text-slate-400 ml-2">(현금주의 — 그날 들어온 건 그날만 카운트)</span></h2>
          <p className="text-slate-400 text-sm mt-1">받아야 할 일자와 실제 통장 입금 일자를 1:1로 매칭. 과거 미납에 분배하지 않음.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowUpload(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg">
            📤 은행 입금내역 업로드
          </button>
          <button onClick={handleExport} disabled={exporting || dailyRows.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg">
            📥 {exporting ? '생성 중...' : '엑셀 다운로드'}
          </button>
        </div>
      </div>

      <DailyDepositUpload
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={() => reloadDeposits(appliedRange.from, appliedRange.to)}
        salespeople={salespeople}
      />

      {/* 기간 선택 */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3">
        <label className="text-xs text-slate-400">기간</label>
        <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
        <span className="text-slate-400">~</span>
        <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
          className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
        <button onClick={() => setAppliedRange(range)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1 rounded">조회</button>
        {loading && <span className="text-xs text-slate-400">로딩 중...</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
          <div className="text-xs text-slate-400">받아야 할 총액</div>
          <div className="text-2xl font-bold text-white mt-1">₩{formatCurrency(kpi.totalReceivable)}</div>
          <div className="text-xs text-slate-500 mt-1">기간 내 모든 계약의 차감 합</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
          <div className="text-xs text-slate-400">실제 들어온</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">₩{formatCurrency(kpi.totalReceived)}</div>
          <div className="text-xs text-slate-500 mt-1">기간 내 통장 입금 합 (현금주의)</div>
        </div>
        <div className={`border rounded-lg p-5 ${kpi.totalUnpaid > 0 ? 'bg-red-900/20 border-red-700/50' : 'bg-emerald-900/20 border-emerald-700/50'}`}>
          <div className="text-xs text-slate-400">미수 (못 받은 돈)</div>
          <div className={`text-2xl font-bold mt-1 ${kpi.totalUnpaid > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            ₩{formatCurrency(kpi.totalUnpaid)}
          </div>
          <div className="text-xs text-slate-500 mt-1">받아야 할 − 들어온</div>
        </div>
      </div>

      {/* 일자별 표 */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-700/50">
            <tr className="text-slate-400">
              <th className="p-3 text-left w-8"></th>
              <th className="p-3 text-left">일자</th>
              <th className="p-3 text-right">받아야 할</th>
              <th className="p-3 text-right">들어온</th>
              <th className="p-3 text-right">차액</th>
              <th className="p-3 text-center">구분</th>
            </tr>
          </thead>
          <tbody>
            {dailyRows.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-slate-500 py-8">기간 내 데이터가 없습니다</td></tr>
            ) : dailyRows.map(r => {
              const isExpanded = expandedDate === r.date;
              return (
                <React.Fragment key={r.date}>
                  <tr className="border-t border-slate-700/50 hover:bg-slate-700/30 cursor-pointer"
                      onClick={() => setExpandedDate(isExpanded ? null : r.date)}>
                    <td className="p-3 text-slate-400">{isExpanded ? '▼' : '▶'}</td>
                    <td className="p-3 text-white">{r.date}</td>
                    <td className="p-3 text-right text-slate-200">₩{formatCurrency(r.receivable)}</td>
                    <td className="p-3 text-right text-emerald-400">₩{formatCurrency(r.received)}</td>
                    <td className={`p-3 text-right font-semibold ${r.diff < 0 ? 'text-red-400' : r.diff > 0 ? 'text-blue-400' : 'text-slate-400'}`}>
                      ₩{formatCurrency(r.diff)}
                    </td>
                    <td className="p-3 text-center">
                      {r.diff < 0 ? <span className="text-red-400 text-xs">미수</span>
                        : r.diff > 0 ? <span className="text-blue-400 text-xs">과입금</span>
                        : <span className="text-slate-400 text-xs">일치</span>}
                    </td>
                  </tr>
                  {isExpanded && drilldown && (
                    <tr><td colSpan={6} className="bg-slate-900/50 p-4">
                      <div className="grid grid-cols-2 gap-4">
                        {/* 들어온 raw */}
                        <div>
                          <h4 className="text-sm font-medium text-emerald-300 mb-2">들어온 ({drilldown.incoming.length}건 · ₩{formatCurrency(drilldown.incoming.reduce((s, d) => s + (Number(d.amount) || 0), 0))})</h4>
                          <div className="bg-slate-900 rounded border border-slate-700 max-h-64 overflow-y-auto">
                            {drilldown.incoming.length === 0 ? (
                              <div className="text-xs text-slate-500 p-3 text-center">입금 없음</div>
                            ) : (
                              <table className="w-full text-xs">
                                <thead className="bg-slate-800 text-slate-400">
                                  <tr><th className="p-2 text-left">영업자</th><th className="p-2 text-left">입금자</th><th className="p-2 text-right">금액</th></tr>
                                </thead>
                                <tbody>
                                  {drilldown.incoming.map(d => (
                                    <tr key={d.id} className="border-t border-slate-700/50">
                                      <td className="p-2 text-slate-300">{d.salesperson_id ? (salespeopleMap.get(d.salesperson_id) || '?') : <span className="text-red-400">미매칭</span>}</td>
                                      <td className="p-2 text-white">{d.depositor_name || '-'}</td>
                                      <td className="p-2 text-right text-emerald-400">₩{formatCurrency(Number(d.amount) || 0)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </div>
                        {/* 받아야 할 raw */}
                        <div>
                          <h4 className="text-sm font-medium text-amber-300 mb-2">받아야 할 ({drilldown.receivable.length}건 · ₩{formatCurrency(drilldown.receivable.reduce((s, x) => s + x.amount, 0))})</h4>
                          <div className="bg-slate-900 rounded border border-slate-700 max-h-64 overflow-y-auto">
                            {drilldown.receivable.length === 0 ? (
                              <div className="text-xs text-slate-500 p-3 text-center">차감 없음</div>
                            ) : (
                              <table className="w-full text-xs">
                                <thead className="bg-slate-800 text-slate-400">
                                  <tr><th className="p-2 text-left">#</th><th className="p-2 text-left">계약자</th><th className="p-2 text-left">총판</th><th className="p-2 text-right">금액</th></tr>
                                </thead>
                                <tbody>
                                  {drilldown.receivable.map(x => (
                                    <tr key={x.contract_number} className="border-t border-slate-700/50">
                                      <td className="p-2 font-mono text-indigo-300">{x.contract_number}</td>
                                      <td className="p-2 text-white">{x.lessee_name}</td>
                                      <td className="p-2 text-slate-400">{x.distributor_name}</td>
                                      <td className="p-2 text-right text-amber-400">₩{formatCurrency(x.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
