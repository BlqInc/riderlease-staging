import React, { useState, useMemo, useCallback } from 'react';
import { Contract, Creditor, CreditorSettlementRound } from '../types';
import { supabase } from '../lib/supabaseClient';
import { fetchPagedRows } from '../lib/fetchPagedRows';
import { formatCurrency } from '../lib/utils';

interface Props {
  contracts: Contract[];
  creditors: Creditor[];
  settlements: CreditorSettlementRound[];
  onCreditorUpdated?: () => void;
}

// 한 계약의 채권액 = (contract_initial_deduction이 있으면 그것 × units, 없으면 daily_deduction) × duration_days
// CreditorSettlement.tsx의 동일 패턴
function contractDebtAmount(c: Contract): number {
  const units = Number(c.units_required) || 1;
  const dur = Number(c.duration_days) || 180;
  const initial = Number((c as any).contract_initial_deduction) || 0;
  const dailyPerUnit = initial > 0 ? initial : (Number(c.daily_deduction) || 0) / Math.max(units, 1);
  const dailyTotal = dailyPerUnit * units;
  return dailyTotal * dur;
}

interface Row {
  creditor: Creditor;
  settlement: CreditorSettlementRound;
  contractCount: number;
  debtAmount: number;       // 채권액
  revenueRate: number | null;  // 채권사 비율
  revenue: number;          // 매출 (공급가액)
  vat: number;              // 부가세 = 채권액 - 매출
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(now.getDate()).padStart(2, '0')}` };
}

interface DateRow {
  date: string;
  creditor: Creditor;
  contractCount: number;
  debtAmount: number;
  revenueRate: number | null;
  revenue: number;
  vat: number;
}

export const TaxInvoiceRevenue: React.FC<Props> = ({ contracts, creditors, settlements, onCreditorUpdated }) => {
  const [editingCreditorId, setEditingCreditorId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedCreditorId, setSelectedCreditorId] = useState<string>('');  // '' = 전체
  const [selectedRounds, setSelectedRounds] = useState<Set<number>>(new Set());  // 차수 다중 선택, 빈 set = 전체
  const [mode, setMode] = useState<'round' | 'date'>('round');

  // 일자별 모드 state
  const [dateRange, setDateRange] = useState(defaultRange);
  const [appliedDateRange, setAppliedDateRange] = useState(defaultRange);
  const [dateRows, setDateRows] = useState<DateRow[]>([]);
  const [dateLoading, setDateLoading] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  // 정산 차수 옵션 (선택된 채권사 한정 또는 전체)
  const roundOptions = useMemo(() => {
    const set = new Set<number>();
    for (const s of settlements) {
      if (selectedCreditorId && s.creditor_id !== selectedCreditorId) continue;
      set.add(s.settlement_round);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [settlements, selectedCreditorId]);

  // 채권사별 정산 차수 × 채권액 계산
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const s of settlements) {
      const creditor = creditors.find(c => c.id === s.creditor_id);
      if (!creditor) continue;
      if (selectedCreditorId && creditor.id !== selectedCreditorId) continue;
      if (selectedRounds.size > 0 && !selectedRounds.has(s.settlement_round)) continue;
      const roundContracts = contracts.filter(
        c => (c as any).creditor_id === s.creditor_id && c.settlement_round === s.settlement_round
      );
      const debtAmount = roundContracts.reduce((sum, c) => sum + contractDebtAmount(c), 0);
      const rate = (creditor as any).revenue_rate != null ? Number((creditor as any).revenue_rate) : null;
      const revenue = rate != null ? Math.round(debtAmount * rate) : 0;
      const vat = rate != null ? debtAmount - revenue : 0;
      out.push({
        creditor,
        settlement: s,
        contractCount: roundContracts.length,
        debtAmount,
        revenueRate: rate,
        revenue,
        vat,
      });
    }
    // 채권사 이름 → 차수 desc 정렬
    out.sort((a, b) => {
      const n = a.creditor.name.localeCompare(b.creditor.name);
      if (n !== 0) return n;
      return b.settlement.settlement_round - a.settlement.settlement_round;
    });
    return out;
  }, [contracts, creditors, settlements, selectedCreditorId, selectedRounds]);

  // 일자별 매출 fetch — daily_deductions 테이블에서 기간 내 행 가져옴
  const reloadDateMode = useCallback(async (from: string, to: string) => {
    if (!supabase) return;
    setDateLoading(true);
    setDateError(null);
    try {
      const dds = await fetchPagedRows<any>(
        'daily_deductions',
        'contract_id, due_date, amount',
        q => q.gte('due_date', from).lte('due_date', to),
      );
      // contract_id → contract 조회 맵
      const contractMap = new Map<string, Contract>();
      contracts.forEach(c => contractMap.set(c.id, c));
      // 일자 × 채권사별 그룹핑
      type Key = string;  // `${date}|${creditor_id}`
      const grouped = new Map<Key, { amount: number; contractIds: Set<string> }>();
      for (const dd of dds) {
        const c = contractMap.get(dd.contract_id);
        if (!c) continue;
        const cid = (c as any).creditor_id;
        if (!cid) continue;
        if (selectedCreditorId && cid !== selectedCreditorId) continue;
        const key = `${dd.due_date}|${cid}`;
        const g = grouped.get(key) || { amount: 0, contractIds: new Set<string>() };
        g.amount += Number(dd.amount) || 0;
        g.contractIds.add(dd.contract_id);
        grouped.set(key, g);
      }
      const out: DateRow[] = [];
      for (const [key, g] of grouped.entries()) {
        const [date, creditorId] = key.split('|');
        const creditor = creditors.find(c => c.id === creditorId);
        if (!creditor) continue;
        const rate = (creditor as any).revenue_rate != null ? Number((creditor as any).revenue_rate) : null;
        const revenue = rate != null ? Math.round(g.amount * rate) : 0;
        const vat = rate != null ? g.amount - revenue : 0;
        out.push({
          date,
          creditor,
          contractCount: g.contractIds.size,
          debtAmount: g.amount,
          revenueRate: rate,
          revenue,
          vat,
        });
      }
      // 정렬: 최근 일자 → 채권사명
      out.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return a.creditor.name.localeCompare(b.creditor.name);
      });
      setDateRows(out);
    } catch (e: any) {
      setDateError('일자별 매출 조회 실패: ' + e.message);
    } finally {
      setDateLoading(false);
    }
  }, [contracts, creditors, selectedCreditorId]);

  // KPI: 표시 중 합계 (모드별)
  const totals = useMemo(() => {
    const src = mode === 'round' ? rows : dateRows;
    return src.reduce(
      (acc: { debt: number; revenue: number; vat: number }, r: any) => ({
        debt: acc.debt + r.debtAmount,
        revenue: acc.revenue + r.revenue,
        vat: acc.vat + r.vat,
      }),
      { debt: 0, revenue: 0, vat: 0 }
    );
  }, [mode, rows, dateRows]);

  const toggleRound = (n: number) => {
    setSelectedRounds(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  };

  const openEdit = (creditor: Creditor) => {
    setEditingCreditorId(creditor.id);
    const rate = (creditor as any).revenue_rate;
    setEditRate(rate != null ? String(rate) : '');
    setEditNote(((creditor as any).revenue_note) || '');
  };

  const closeEdit = () => {
    setEditingCreditorId(null);
    setEditRate('');
    setEditNote('');
  };

  const saveEdit = async () => {
    if (!supabase || !editingCreditorId || saving) return;
    const numRate = editRate.trim() === '' ? null : Number(editRate);
    if (numRate != null && (isNaN(numRate) || numRate < 0 || numRate > 2)) {
      alert('비율은 0~2 사이의 숫자여야 합니다 (예: 0.909 = 채권액/1.1)');
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase.from('creditors') as any)
        .update({ revenue_rate: numRate, revenue_note: editNote.trim() || null })
        .eq('id', editingCreditorId);
      if (error) throw error;
      closeEdit();
      onCreditorUpdated?.();
    } catch (e: any) {
      alert('저장 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    const isRound = mode === 'round';
    if (exporting) return;
    if (isRound && rows.length === 0) return;
    if (!isRound && dateRows.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx-js-style');
      const header = isRound
        ? ['채권사', '정산 차수', '기간', '계약 수', '채권액', '비율(rate)', '매출(공급가액)', '부가세']
        : ['일자', '채권사', '계약 수', '채권액', '비율(rate)', '매출(공급가액)', '부가세'];
      const dataRows = isRound
        ? rows.map(r => [
            r.creditor.name,
            `${r.settlement.settlement_round}차`,
            `${r.settlement.start_date} ~ ${r.settlement.end_date}`,
            r.contractCount,
            r.debtAmount,
            r.revenueRate ?? '',
            r.revenueRate != null ? r.revenue : '(비율 미설정)',
            r.revenueRate != null ? r.vat : '',
          ])
        : dateRows.map(r => [
            r.date,
            r.creditor.name,
            r.contractCount,
            r.debtAmount,
            r.revenueRate ?? '',
            r.revenueRate != null ? r.revenue : '(비율 미설정)',
            r.revenueRate != null ? r.vat : '',
          ]);
      const title = isRound
        ? '세금계산서 매출 — 채권사 × 정산 차수별'
        : `세금계산서 매출 — 일자별 (${appliedDateRange.from} ~ ${appliedDateRange.to})`;
      const totalRow = isRound
        ? ['합계', '', '', '', totals.debt, '', totals.revenue, totals.vat]
        : ['합계', '', '', totals.debt, '', totals.revenue, totals.vat];
      const aoa: any[][] = [
        [title],
        header,
        ...dataRows,
        [],
        totalRow,
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const headerStyle = {
        fill: { fgColor: { rgb: '4472C4' } },
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      };
      for (let c = 0; c < header.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 1, c });
        if (ws[addr]) ws[addr].s = headerStyle;
      }
      // 숫자 콤마 (모드별 컬럼 인덱스 다름)
      const numericCols = isRound ? [3, 4, 6, 7] : [2, 3, 5, 6];
      for (let r = 2; r < aoa.length; r++) {
        for (const c of numericCols) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = '#,##0';
        }
      }
      ws['!cols'] = isRound
        ? [{ wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }]
        : [{ wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, isRound ? '정산 차수별' : '일자별');
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const fname = isRound
        ? `세금계산서매출_차수_${today}.xlsx`
        : `세금계산서매출_일자_${appliedDateRange.from.replace(/-/g,'')}-${appliedDateRange.to.replace(/-/g,'')}.xlsx`;
      XLSX.writeFile(wb, fname);
    } catch (e: any) {
      alert('엑셀 생성 실패: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  const editingCreditor = editingCreditorId ? creditors.find(c => c.id === editingCreditorId) : null;

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-3xl font-bold text-white">세금계산서 매출</h2>
          <p className="text-slate-400 text-sm mt-1">
            채권사별 정산 차수의 채권액을 비율로 환산한 매출(공급가액)·부가세 자동 계산.
            <span className="text-slate-500"> 매출 = 채권액 × 비율, 부가세 = 채권액 − 매출</span>
          </p>
        </div>
        <button onClick={handleExport}
          disabled={exporting || (mode === 'round' ? rows.length === 0 : dateRows.length === 0)}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg">
          📥 {exporting ? '생성 중...' : '엑셀 다운로드'}
        </button>
      </div>

      {/* 모드 탭 */}
      <div className="flex gap-1 border-b border-slate-700">
        <button onClick={() => setMode('round')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === 'round' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
          }`}>
          정산 차수별
        </button>
        <button onClick={() => setMode('date')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === 'date' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
          }`}>
          일자별
        </button>
      </div>

      {/* 채권사 필터 (양쪽 모드 공통) */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3 flex-wrap">
        <label className="text-xs text-slate-400">채권사 필터</label>
        <button onClick={() => setSelectedCreditorId('')}
          className={`text-xs px-3 py-1 rounded ${selectedCreditorId === '' ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
          전체
        </button>
        {creditors.map(c => (
          <button key={c.id} onClick={() => setSelectedCreditorId(c.id)}
            className={`text-xs px-3 py-1 rounded ${selectedCreditorId === c.id ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            {c.name}
            {(c as any).revenue_rate != null
              ? <span className="ml-1 text-emerald-400">· {(c as any).revenue_rate}</span>
              : <span className="ml-1 text-red-400">· 미설정</span>}
          </button>
        ))}
      </div>

      {/* 정산 차수별 모드 — 차수 필터 */}
      {mode === 'round' && roundOptions.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3 flex-wrap">
          <label className="text-xs text-slate-400">정산 차수 필터</label>
          <button onClick={() => setSelectedRounds(new Set())}
            className={`text-xs px-3 py-1 rounded ${selectedRounds.size === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
            전체
          </button>
          {roundOptions.map(n => (
            <button key={n} onClick={() => toggleRound(n)}
              className={`text-xs px-3 py-1 rounded ${selectedRounds.has(n) ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
              {n}차
            </button>
          ))}
          {selectedRounds.size > 0 && (
            <span className="text-xs text-slate-500 ml-auto">{selectedRounds.size}개 선택</span>
          )}
        </div>
      )}

      {/* 일자별 모드 — 기간 선택 */}
      {mode === 'date' && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center gap-3 flex-wrap">
          <label className="text-xs text-slate-400">기간</label>
          <input type="date" value={dateRange.from} onChange={e => setDateRange(r => ({ ...r, from: e.target.value }))}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
          <span className="text-slate-400">~</span>
          <input type="date" value={dateRange.to} onChange={e => setDateRange(r => ({ ...r, to: e.target.value }))}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
          <button onClick={() => { setAppliedDateRange(dateRange); reloadDateMode(dateRange.from, dateRange.to); }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1 rounded">조회</button>
          {dateLoading && <span className="text-xs text-slate-400">로딩 중...</span>}
          {dateError && <span className="text-xs text-red-400">{dateError}</span>}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
          <div className="text-xs text-slate-400">채권액 총계</div>
          <div className="text-2xl font-bold text-white mt-1">₩{formatCurrency(totals.debt)}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
          <div className="text-xs text-slate-400">매출 (공급가액)</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">₩{formatCurrency(totals.revenue)}</div>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-5">
          <div className="text-xs text-slate-400">부가세</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">₩{formatCurrency(totals.vat)}</div>
        </div>
      </div>

      {/* 표 — 정산 차수별 */}
      {mode === 'round' && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-700/50">
              <tr className="text-slate-400">
                <th className="p-3 text-left">채권사</th>
                <th className="p-3 text-center">차수</th>
                <th className="p-3 text-left">기간</th>
                <th className="p-3 text-right">계약</th>
                <th className="p-3 text-right">채권액</th>
                <th className="p-3 text-center">비율</th>
                <th className="p-3 text-right">매출</th>
                <th className="p-3 text-right">부가세</th>
                <th className="p-3 text-center">편집</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-slate-500 py-8">정산 차수가 없습니다</td></tr>
              ) : rows.map(r => (
                <tr key={`${r.creditor.id}|${r.settlement.id}`} className="border-t border-slate-700/50 hover:bg-slate-700/30">
                  <td className="p-3 text-white">{r.creditor.name}</td>
                  <td className="p-3 text-center text-slate-300">{r.settlement.settlement_round}차</td>
                  <td className="p-3 text-xs text-slate-400">{r.settlement.start_date} ~ {r.settlement.end_date}</td>
                  <td className="p-3 text-right text-slate-300">{r.contractCount}건</td>
                  <td className="p-3 text-right text-slate-200">₩{formatCurrency(r.debtAmount)}</td>
                  <td className="p-3 text-center">
                    {r.revenueRate != null ? (
                      <span className="text-emerald-300 font-mono text-xs">{r.revenueRate}</span>
                    ) : (
                      <span className="text-red-400 text-xs">미설정</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-emerald-400">
                    {r.revenueRate != null ? `₩${formatCurrency(r.revenue)}` : '-'}
                  </td>
                  <td className="p-3 text-right text-amber-400">
                    {r.revenueRate != null ? `₩${formatCurrency(r.vat)}` : '-'}
                  </td>
                  <td className="p-3 text-center">
                    <button onClick={() => openEdit(r.creditor)}
                      className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded">
                      비율 편집
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 표 — 일자별 */}
      {mode === 'date' && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700 text-xs text-slate-400">
            기간: {appliedDateRange.from} ~ {appliedDateRange.to} · 일별 회수 예정 채권액 기준 (daily_deductions)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-700/50">
              <tr className="text-slate-400">
                <th className="p-3 text-left">일자</th>
                <th className="p-3 text-left">채권사</th>
                <th className="p-3 text-right">계약</th>
                <th className="p-3 text-right">채권액</th>
                <th className="p-3 text-center">비율</th>
                <th className="p-3 text-right">매출</th>
                <th className="p-3 text-right">부가세</th>
              </tr>
            </thead>
            <tbody>
              {dateLoading ? (
                <tr><td colSpan={7} className="text-center text-slate-500 py-8">로딩 중...</td></tr>
              ) : dateRows.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-slate-500 py-8">조회 결과가 없습니다. [조회] 버튼을 눌러주세요.</td></tr>
              ) : dateRows.map(r => (
                <tr key={`${r.date}|${r.creditor.id}`} className="border-t border-slate-700/50 hover:bg-slate-700/30">
                  <td className="p-3 text-slate-300">{r.date}</td>
                  <td className="p-3 text-white">{r.creditor.name}</td>
                  <td className="p-3 text-right text-slate-300">{r.contractCount}건</td>
                  <td className="p-3 text-right text-slate-200">₩{formatCurrency(r.debtAmount)}</td>
                  <td className="p-3 text-center">
                    {r.revenueRate != null ? (
                      <span className="text-emerald-300 font-mono text-xs">{r.revenueRate}</span>
                    ) : (
                      <span className="text-red-400 text-xs">미설정</span>
                    )}
                  </td>
                  <td className="p-3 text-right text-emerald-400">
                    {r.revenueRate != null ? `₩${formatCurrency(r.revenue)}` : '-'}
                  </td>
                  <td className="p-3 text-right text-amber-400">
                    {r.revenueRate != null ? `₩${formatCurrency(r.vat)}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 비율 편집 모달 */}
      {editingCreditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !saving && closeEdit()}>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[480px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-white font-semibold text-lg">{editingCreditor.name} 비율 설정</h3>
                <p className="text-xs text-slate-400 mt-1">매출 = 채권액 × 비율. 부가세 = 채권액 − 매출.</p>
              </div>
              <button onClick={closeEdit} disabled={saving} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">비율 (revenue_rate)</label>
                <input type="number" step="0.0001" value={editRate}
                  onChange={e => setEditRate(e.target.value)}
                  placeholder="예: 0.909 (VAT 10% 분리 = 1/1.1) 또는 0.95 (수수료 5% 차감)"
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white" />
                <p className="text-[10px] text-slate-500 mt-1">
                  · VAT 10% 분리: 0.9091 (≈ 1/1.1) — 매출/부가세 분리<br/>
                  · 수수료 5% 차감: 0.95 — 채권액의 95%가 매출<br/>
                  · 비워두면 미설정 — 표에서 매출/부가세 표시 안 됨
                </p>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">메모 (선택)</label>
                <input type="text" value={editNote}
                  onChange={e => setEditNote(e.target.value)}
                  placeholder="예: VAT 10% 분리"
                  className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={closeEdit} disabled={saving}
                className="text-sm px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50">취소</button>
              <button onClick={saveEdit} disabled={saving}
                className="text-sm px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
