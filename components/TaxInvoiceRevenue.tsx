import React, { useState, useMemo } from 'react';
import { Contract, Creditor, CreditorSettlementRound } from '../types';
import { supabase } from '../lib/supabaseClient';
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

export const TaxInvoiceRevenue: React.FC<Props> = ({ contracts, creditors, settlements, onCreditorUpdated }) => {
  const [editingCreditorId, setEditingCreditorId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedCreditorId, setSelectedCreditorId] = useState<string>('');  // '' = 전체

  // 채권사별 정산 차수 × 채권액 계산
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const s of settlements) {
      const creditor = creditors.find(c => c.id === s.creditor_id);
      if (!creditor) continue;
      if (selectedCreditorId && creditor.id !== selectedCreditorId) continue;
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
  }, [contracts, creditors, settlements, selectedCreditorId]);

  // KPI: 표시 중 합계
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        debt: acc.debt + r.debtAmount,
        revenue: acc.revenue + r.revenue,
        vat: acc.vat + r.vat,
      }),
      { debt: 0, revenue: 0, vat: 0 }
    );
  }, [rows]);

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
    if (exporting || rows.length === 0) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx-js-style');
      const header = ['채권사', '정산 차수', '기간', '계약 수', '채권액', '비율(rate)', '매출(공급가액)', '부가세'];
      const dataRows = rows.map(r => [
        r.creditor.name,
        `${r.settlement.settlement_round}차`,
        `${r.settlement.start_date} ~ ${r.settlement.end_date}`,
        r.contractCount,
        r.debtAmount,
        r.revenueRate ?? '',
        r.revenueRate != null ? r.revenue : '(비율 미설정)',
        r.revenueRate != null ? r.vat : '',
      ]);
      const aoa: any[][] = [
        ['세금계산서 매출 — 채권사 × 정산 차수별'],
        header,
        ...dataRows,
        [],
        ['합계', '', '', '', totals.debt, '', totals.revenue, totals.vat],
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
      // 숫자 콤마
      for (let r = 2; r < aoa.length; r++) {
        for (const c of [3, 4, 6, 7]) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = '#,##0';
        }
      }
      ws['!cols'] = [
        { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 8 },
        { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '세금계산서 매출');
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      XLSX.writeFile(wb, `세금계산서매출_${today}.xlsx`);
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
        <button onClick={handleExport} disabled={exporting || rows.length === 0}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 px-4 rounded-lg">
          📥 {exporting ? '생성 중...' : '엑셀 다운로드'}
        </button>
      </div>

      {/* 채권사 필터 */}
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

      {/* 표 */}
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
