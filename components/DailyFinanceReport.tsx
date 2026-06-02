import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Contract, ContractStatus } from '../types';
import { supabase } from '../lib/supabaseClient';
import { fetchPagedRows } from '../lib/fetchPagedRows';
import { formatCurrency } from '../lib/utils';
import { DailyDepositUpload } from './DailyDepositUpload';
import { DailyDepositHistory } from './DailyDepositHistory';

interface SalespersonProp {
  id: string;
  name: string;
  bank_aliases?: string[];
  partner_ids?: string[];
}

interface Props {
  contracts: Contract[];
  salespeople: SalespersonProp[];
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
  received: number;    // 실제 들어온 (영업자 매칭된 것만)
  diff: number;        // 들어온 - 받아야 할 (음수=미수, 양수=과입금)
  unpaid: number;      // max(0, 받아야 할 - 들어온) — 그날 못 받은 돈
  balance: number;     // 누적 잔액 = 누적 받아야 할 - 누적 들어온 (양수=미수, 음수=과입금)
}

// ─── 헬퍼 ───
// 회수관리 RPC(get_daily_recovery_metrics)와 동일한 코호트 필터.
// 2025-10-01 이전 실행 계약은 회수 대상에서 제외.
const COHORT_EXEC_FROM = '2025-10-01';

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

export const DailyFinanceReport: React.FC<Props> = ({ contracts, salespeople: salespeopleProp }) => {
  const [range, setRange] = useState(defaultRange);
  const [appliedRange, setAppliedRange] = useState(defaultRange);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // contracts.daily_deductions가 비어있을 수 있어 별도 보관
  const [ddByContract, setDdByContract] = useState<Map<string, any[]>>(new Map());
  const [ddLoaded, setDdLoaded] = useState(false);
  const [deposits, setDeposits] = useState<BankDepositRow[]>([]);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedSalesperson, setExpandedSalesperson] = useState<string | null>(null);

  // props로 받은 salespeople을 그대로 사용 (partner_ids 포함)
  const salespeople = salespeopleProp;
  // 영업자명 빠른 조회 맵
  const salespeopleMap = useMemo(() => {
    const m = new Map<string, string>();
    salespeople.forEach(s => m.set(s.id, s.name));
    return m;
  }, [salespeople]);

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
      } catch (e: any) {
        setError('daily_deductions 로드 실패: ' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [ddLoaded]);

  // 2) 기간 적용 시 daily_bank_deposits 조회 (회수관리 bank_deposits와 완전 분리)
  //    페이지네이션으로 1000건 초과해도 안전
  const reloadDeposits = useCallback(async (from: string, to: string) => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPagedRows<BankDepositRow>(
        'daily_bank_deposits',
        'id, deposit_date, depositor_name, amount, salesperson_id',
        q => q.gte('deposit_date', from).lte('deposit_date', to).is('reverted_at', null),
      );
      setDeposits(data);
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
    // - 만료(EXPIRED) 계약 제외
    // - 회수관리 기준과 일치: execution_date >= 2025-10-01 코호트 필터
    const receivableByDate = new Map<string, number>();
    for (const c of contracts) {
      if (c.status === ContractStatus.EXPIRED) continue;
      if (!c.execution_date || c.execution_date < COHORT_EXEC_FROM) continue;
      const dds = ddByContract.get(c.id) || [];
      for (const dd of dds) {
        if (!dd?.date) continue;
        if (dd.date < from || dd.date > to) continue;
        const amt = Number(dd.amount) || 0;
        receivableByDate.set(dd.date, (receivableByDate.get(dd.date) || 0) + amt);
      }
    }
    // 들어온: daily_bank_deposits.amount 합 (영업자 매칭된 것만)
    const receivedByDate = new Map<string, number>();
    for (const d of deposits) {
      if (!d.deposit_date) continue;
      if (!d.salesperson_id) continue;  // 미매칭 제외
      receivedByDate.set(d.deposit_date, (receivedByDate.get(d.deposit_date) || 0) + (Number(d.amount) || 0));
    }
    // 기간 내 모든 일자 행 생성 — 일자 ASC로 먼저 만들면서 누적 잔액 계산
    const rows: DailyRow[] = [];
    const dates = eachDateInRange(from, to);
    let runningBalance = 0;
    for (const date of dates) {
      const receivable = receivableByDate.get(date) || 0;
      const received = receivedByDate.get(date) || 0;
      if (receivable === 0 && received === 0) continue;
      const diff = received - receivable;
      const unpaid = Math.max(0, receivable - received);
      runningBalance += (receivable - received);  // 받아야 할 누적 - 들어온 누적
      rows.push({ date, receivable, received, diff, unpaid, balance: runningBalance });
    }
    // 표시는 최근 일자 위 (balance는 위에서 ASC로 계산했으므로 정렬 후에도 정확)
    rows.sort((a, b) => a.date < b.date ? 1 : -1);
    return rows;
  }, [ddLoaded, ddByContract, contracts, deposits, appliedRange]);

  // 4) KPI 합계
  const kpi = useMemo(() => {
    const totalReceivable = dailyRows.reduce((s, r) => s + r.receivable, 0);
    const totalReceived = dailyRows.reduce((s, r) => s + r.received, 0);
    // 기간 미수: 단순 차이. 과입금이 미수를 차감.
    // (일자별 미수 컬럼은 그대로 표시 — 그날만 보는 관점)
    const totalUnpaid = Math.max(0, totalReceivable - totalReceived);
    return { totalReceivable, totalReceived, totalUnpaid };
  }, [dailyRows]);

  // 미매칭 입금 (영업자 매칭 안 됨) 합계 — 별도 표시용
  const unmatchedDeposits = useMemo(() => {
    const rows = deposits.filter(d => !d.salesperson_id);
    const total = rows.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    return { count: rows.length, total };
  }, [deposits]);

  // partner_id → salesperson_id 매핑 (영업자별 그룹핑용)
  const partnerToSp = useMemo(() => {
    const m = new Map<string, string>();
    salespeople.forEach(s => (s.partner_ids || []).forEach(pid => m.set(pid, s.id)));
    return m;
  }, [salespeople]);

  // 5) 드릴다운 데이터: 그 일자의 raw 내역 + 영업자별 분배 시뮬레이션
  type SpGroup = {
    sp_id: string;
    sp_name: string;
    incoming: number;       // 그날 그 영업자 입금 합 (매칭된 것만)
    receivable: number;     // 그날 담당 계약의 차감 합
    unpaid: number;         // max(0, receivable - incoming)
    contracts: {
      contract_number: number;
      lessee_name: string;
      distributor_name: string;
      amount: number;
      filled: number;        // 분배된 금액
      remaining: number;     // 미납 잔여
      status: '완납' | '일부' | '미납';
    }[];
  };
  const drilldown = useMemo(() => {
    if (!expandedDate) return null;
    const incoming = deposits.filter(d => d.deposit_date === expandedDate);
    // 받아야 할 raw (그 일자 차감 있는 계약) — 받아야 할 합산과 동일한 필터 적용
    type RawReceivable = { contract_number: number; lessee_name: string; distributor_name: string; partner_id: string | null; amount: number };
    const receivable: RawReceivable[] = [];
    for (const c of contracts) {
      if (c.status === ContractStatus.EXPIRED) continue;
      if (!c.execution_date || c.execution_date < COHORT_EXEC_FROM) continue;
      const dds = ddByContract.get(c.id) || [];
      const dd = dds.find((x: any) => x?.date === expandedDate);
      if (!dd) continue;
      const amt = Number(dd.amount) || 0;
      if (amt === 0) continue;
      receivable.push({
        contract_number: Number(c.contract_number) || 0,
        lessee_name: c.lessee_name || '',
        distributor_name: c.distributor_name || '',
        partner_id: c.partner_id || null,
        amount: amt,
      });
    }
    receivable.sort((a, b) => a.contract_number - b.contract_number);

    // 영업자별 그룹핑 + 분배 시뮬레이션
    // 1) 영업자별 그날 입금 합
    const spIncoming = new Map<string, number>();
    for (const d of incoming) {
      if (!d.salesperson_id) continue;
      spIncoming.set(d.salesperson_id, (spIncoming.get(d.salesperson_id) || 0) + (Number(d.amount) || 0));
    }
    // 2) 영업자별 담당 계약
    const spContracts = new Map<string, RawReceivable[]>();
    const orphanReceivable: RawReceivable[] = [];  // 영업자 매칭 안 된 받아야 할
    for (const r of receivable) {
      const spId = r.partner_id ? partnerToSp.get(r.partner_id) : undefined;
      if (spId) {
        const arr = spContracts.get(spId) || [];
        arr.push(r);
        spContracts.set(spId, arr);
      } else {
        orphanReceivable.push(r);
      }
    }
    // 3) 각 영업자별 분배: 계약번호 오름차순으로 입금 채움
    const spGroups: SpGroup[] = [];
    const allSpIds = new Set<string>([...spIncoming.keys(), ...spContracts.keys()]);
    for (const spId of allSpIds) {
      const incomingTotal = spIncoming.get(spId) || 0;
      const cs = (spContracts.get(spId) || []).slice().sort((a, b) => a.contract_number - b.contract_number);
      let remaining = incomingTotal;
      const distributed = cs.map(c => {
        let filled = 0;
        if (remaining <= 0) {
          filled = 0;
        } else if (remaining >= c.amount) {
          filled = c.amount;
          remaining -= c.amount;
        } else {
          filled = remaining;
          remaining = 0;
        }
        const rem = c.amount - filled;
        const status: '완납' | '일부' | '미납' = rem === 0 ? '완납' : filled === 0 ? '미납' : '일부';
        return { ...c, filled, remaining: rem, status };
      });
      const receivableTotal = cs.reduce((s, x) => s + x.amount, 0);
      spGroups.push({
        sp_id: spId,
        sp_name: salespeopleMap.get(spId) || '?',
        incoming: incomingTotal,
        receivable: receivableTotal,
        unpaid: Math.max(0, receivableTotal - incomingTotal),
        contracts: distributed,
      });
    }
    // 정렬: 미수 많은 영업자 먼저
    spGroups.sort((a, b) => b.unpaid - a.unpaid);

    return { incoming, receivable, spGroups, orphanReceivable };
  }, [expandedDate, deposits, contracts, ddByContract, partnerToSp, salespeopleMap]);

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
        ['일자', '받아야 할', '들어온', '차액', '미수', '누적 잔액', '구분'],
        ...dailyRows.map(r => [
          r.date, r.receivable, r.received, r.diff, r.unpaid, r.balance,
          r.diff < 0 ? '미수' : r.diff > 0 ? '과입금' : '일치',
        ]),
        [],
        ['합계', kpi.totalReceivable, kpi.totalReceived, kpi.totalReceived - kpi.totalReceivable, kpi.totalUnpaid, '', kpi.totalUnpaid > 0 ? '미수' : '완납'],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
      const headerStyle = {
        fill: { fgColor: { rgb: '4472C4' } },
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center' },
        border: { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      };
      for (let c = 0; c < 7; c++) {
        const addr = XLSX.utils.encode_cell({ r: 1, c });
        if (ws1[addr]) ws1[addr].s = headerStyle;
      }
      // 숫자 콤마
      for (let r = 2; r < summaryRows.length; r++) {
        for (const c of [1, 2, 3, 4, 5]) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws1[addr] && typeof ws1[addr].v === 'number') ws1[addr].z = '#,##0';
        }
      }
      ws1['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];

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

      // Sheet 3: 받아야 할 raw — 일자×계약 행 단위 (검증용)
      // 받아야 할 합산과 동일한 필터 적용
      const receivableRawHeader = [
        '일자', '계약번호', '계약자', '총판', '영업자',
        'contract_status', 'is_lawsuit', 'execution_date', 'expiry_date',
        'dd_status', 'amount', 'paid_amount',
      ];
      const receivableRaw: any[][] = [['받아야 할 raw — 시스템이 받아야 할에 포함시킨 모든 계약×일자'], receivableRawHeader];
      const { from: rFrom, to: rTo } = appliedRange;
      for (const c of contracts) {
        if (c.status === 'EXPIRED' as any) continue;
        if (!c.execution_date || c.execution_date < COHORT_EXEC_FROM) continue;
        const dds = ddByContract.get(c.id) || [];
        const sp = c.partner_id ? partnerToSp.get(c.partner_id) : undefined;
        const spName = sp ? salespeopleMap.get(sp) || '' : '';
        for (const dd of dds) {
          if (!dd?.date) continue;
          if (dd.date < rFrom || dd.date > rTo) continue;
          const amt = Number(dd.amount) || 0;
          receivableRaw.push([
            dd.date,
            c.contract_number ?? '',
            c.lessee_name || '',
            c.distributor_name || '',
            spName,
            c.status || '',
            c.is_lawsuit === true ? 'true' : c.is_lawsuit === false ? 'false' : '',
            c.execution_date || '',
            c.expiry_date || '',
            dd.status || '',
            amt,
            Number(dd.paid_amount) || 0,
          ]);
        }
      }
      // 정렬: 일자 ASC → 계약번호 ASC
      receivableRaw.splice(2, receivableRaw.length - 2, ...receivableRaw.slice(2).sort((a, b) => {
        const da = String(a[0]), db = String(b[0]);
        if (da !== db) return da < db ? -1 : 1;
        return (Number(a[1]) || 0) - (Number(b[1]) || 0);
      }));
      const ws3 = XLSX.utils.aoa_to_sheet(receivableRaw);
      for (let c = 0; c < receivableRawHeader.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 1, c });
        if (ws3[addr]) ws3[addr].s = headerStyle;
      }
      for (let r = 2; r < receivableRaw.length; r++) {
        for (const col of [10, 11]) {
          const addr = XLSX.utils.encode_cell({ r, c: col });
          if (ws3[addr] && typeof ws3[addr].v === 'number') ws3[addr].z = '#,##0';
        }
      }
      ws3['!cols'] = [
        { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 12 },
        { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
        { wch: 10 }, { wch: 12 }, { wch: 12 },
      ];
      XLSX.utils.book_append_sheet(wb, ws3, '받아야 할 raw');

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
          <button onClick={() => setShowHistory(true)}
            className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-lg">
            📋 업로드 이력
          </button>
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
      <DailyDepositHistory
        open={showHistory}
        onClose={() => setShowHistory(false)}
        onReverted={() => reloadDeposits(appliedRange.from, appliedRange.to)}
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

      {/* 미매칭 경고 배너 */}
      {unmatchedDeposits.count > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3 text-xs text-amber-200">
          ⚠ 영업자 매칭 안 된 입금 <b>{unmatchedDeposits.count}건 · ₩{formatCurrency(unmatchedDeposits.total)}</b>
          이 KPI/일자별 합계에서 제외됩니다. 영업자 관리에서 해당 입금자명을 bank_aliases에 추가하면 다음 조회부터 잡힙니다.
          <span className="text-amber-300/70 ml-1">(드릴다운 raw 내역에는 그대로 표시)</span>
        </div>
      )}

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
              <th className="p-3 text-right">미수</th>
              <th className="p-3 text-right">누적 잔액</th>
              <th className="p-3 text-center">구분</th>
            </tr>
          </thead>
          <tbody>
            {dailyRows.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-slate-500 py-8">기간 내 데이터가 없습니다</td></tr>
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
                    <td className="p-3 text-right">
                      {r.unpaid > 0
                        ? <span className="text-red-400 font-semibold">₩{formatCurrency(r.unpaid)}</span>
                        : <span className="text-slate-600">-</span>}
                    </td>
                    <td className={`p-3 text-right font-semibold ${r.balance > 0 ? 'text-red-400' : r.balance < 0 ? 'text-blue-400' : 'text-slate-400'}`}>
                      ₩{formatCurrency(r.balance)}
                    </td>
                    <td className="p-3 text-center">
                      {r.diff < 0 ? <span className="text-red-400 text-xs">미수</span>
                        : r.diff > 0 ? <span className="text-blue-400 text-xs">과입금</span>
                        : <span className="text-slate-400 text-xs">일치</span>}
                    </td>
                  </tr>
                  {isExpanded && drilldown && (
                    <tr><td colSpan={8} className="bg-slate-900/50 p-4 space-y-4">
                      {/* 영업자별 분배 시뮬레이션 (계약번호 오름차순) */}
                      <div className="bg-slate-900 rounded border border-slate-700 p-3">
                        <h4 className="text-sm font-medium text-indigo-300 mb-2">
                          영업자별 분배 ({drilldown.spGroups.length}명)
                          <span className="text-xs text-slate-500 ml-2">— 그날 입금을 담당 계약에 계약번호 오름차순으로 채움</span>
                        </h4>
                        {drilldown.spGroups.length === 0 ? (
                          <div className="text-xs text-slate-500 p-3 text-center">영업자 매칭된 데이터 없음</div>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="bg-slate-800 text-slate-400">
                              <tr>
                                <th className="p-2 text-left w-8"></th>
                                <th className="p-2 text-left">영업자</th>
                                <th className="p-2 text-right">그날 입금</th>
                                <th className="p-2 text-right">담당 받아야 할</th>
                                <th className="p-2 text-right">미수</th>
                                <th className="p-2 text-center">상태</th>
                              </tr>
                            </thead>
                            <tbody>
                              {drilldown.spGroups.map(g => {
                                const key = `${r.date}|${g.sp_id}`;
                                const spExp = expandedSalesperson === key;
                                return (
                                  <React.Fragment key={g.sp_id}>
                                    <tr className="border-t border-slate-700/50 hover:bg-slate-700/30 cursor-pointer"
                                        onClick={() => setExpandedSalesperson(spExp ? null : key)}>
                                      <td className="p-2 text-slate-400">{spExp ? '▼' : '▶'}</td>
                                      <td className="p-2 text-white">{g.sp_name}</td>
                                      <td className="p-2 text-right text-emerald-400">₩{formatCurrency(g.incoming)}</td>
                                      <td className="p-2 text-right text-slate-200">₩{formatCurrency(g.receivable)}</td>
                                      <td className={`p-2 text-right font-semibold ${g.unpaid > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                                        {g.unpaid > 0 ? `₩${formatCurrency(g.unpaid)}` : '-'}
                                      </td>
                                      <td className="p-2 text-center">
                                        {g.unpaid > 0
                                          ? <span className="text-red-400">미수</span>
                                          : g.incoming > g.receivable
                                            ? <span className="text-blue-400">과입금</span>
                                            : <span className="text-emerald-400">완납</span>}
                                      </td>
                                    </tr>
                                    {spExp && (
                                      <tr><td colSpan={6} className="bg-slate-900 p-3">
                                        {g.contracts.length === 0 ? (
                                          <div className="text-xs text-slate-500 text-center py-2">담당 계약 없음 (입금만 있음)</div>
                                        ) : (
                                          <table className="w-full text-[11px]">
                                            <thead className="text-slate-500">
                                              <tr>
                                                <th className="p-1 text-left">#</th>
                                                <th className="p-1 text-left">계약자</th>
                                                <th className="p-1 text-left">총판</th>
                                                <th className="p-1 text-right">받아야 할</th>
                                                <th className="p-1 text-right">채워진</th>
                                                <th className="p-1 text-right">미수</th>
                                                <th className="p-1 text-center">상태</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {g.contracts.map(c => (
                                                <tr key={c.contract_number} className="border-t border-slate-700/30">
                                                  <td className="p-1 font-mono text-indigo-300">{c.contract_number}</td>
                                                  <td className="p-1 text-slate-200">{c.lessee_name}</td>
                                                  <td className="p-1 text-slate-500">{c.distributor_name}</td>
                                                  <td className="p-1 text-right text-slate-300">₩{formatCurrency(c.amount)}</td>
                                                  <td className="p-1 text-right text-emerald-400">₩{formatCurrency(c.filled)}</td>
                                                  <td className="p-1 text-right text-red-400">{c.remaining > 0 ? `₩${formatCurrency(c.remaining)}` : '-'}</td>
                                                  <td className="p-1 text-center">
                                                    {c.status === '완납' ? <span className="text-emerald-400">완납</span>
                                                      : c.status === '일부' ? <span className="text-amber-400">일부</span>
                                                      : <span className="text-red-400">미납</span>}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        )}
                                      </td></tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>

                      {/* 영업자 매칭 안 된 받아야 할 (있을 때만) */}
                      {drilldown.orphanReceivable.length > 0 && (
                        <div className="bg-amber-900/10 border border-amber-700/30 rounded p-3 text-xs">
                          <span className="text-amber-300">⚠ 영업자 매칭 안 된 계약 {drilldown.orphanReceivable.length}건 · 받아야 할 ₩{formatCurrency(drilldown.orphanReceivable.reduce((s, x) => s + x.amount, 0))}</span>
                          <span className="text-slate-500 ml-2">(파트너→영업자 매핑 없음. 영업자 관리에서 매핑 필요)</span>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        {/* 들어온 raw (매칭된 것만 합계 — 미매칭 행도 표시되지만 합계 X) */}
                        <div>
                          <h4 className="text-sm font-medium text-emerald-300 mb-2">
                            들어온 ({drilldown.incoming.length}건 · 매칭 ₩{formatCurrency(drilldown.incoming.filter(d => d.salesperson_id).reduce((s, d) => s + (Number(d.amount) || 0), 0))})
                          </h4>
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
