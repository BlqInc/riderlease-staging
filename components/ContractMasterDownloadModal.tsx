import React, { useState, useMemo } from 'react';
import { Contract, ContractStatus } from '../types';

interface Salesperson {
  id: string;
  name: string;
  bank_aliases?: string[];
  partner_ids?: string[];
}
interface Creditor { id: string; name: string }

interface Props {
  open: boolean;
  onClose: () => void;
  contracts: Contract[];
  creditors: Creditor[];
  salespeople: Salesperson[];
}

type DateBasis = 'contract_date' | 'execution_date' | 'expiry_date';

const ALL_COLS = [
  '계약번호1', '계약번호2', '계약번호3', '계약자(라이더)', '총판', '보증인',
  '입금자', '영업제휴사', '채권사', '상품명', '수량', '총채권금액', '총원가금액',
  '계약일', '계약실행일', '계약종료일', '회수실행일', '회수종료일',
] as const;
type ColName = typeof ALL_COLS[number];

const DEFAULT_SELECTED: Set<ColName> = new Set(ALL_COLS.filter(c => c !== '보증인'));

function todayYY(): string {
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function thisYearFrom(): string {
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}
function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const ContractMasterDownloadModal: React.FC<Props> = ({ open, onClose, contracts, creditors, salespeople }) => {
  // 필터 state
  const [distributor, setDistributor] = useState<string>('');
  const [lessee, setLessee] = useState<string>('');
  const [salesId, setSalesId] = useState<string>('');
  const [creditorId, setCreditorId] = useState<string>('');
  const [device, setDevice] = useState<string>('');
  const [statusF, setStatusF] = useState<string>('');

  // 기간 필터
  const [dateBasis, setDateBasis] = useState<DateBasis>('contract_date');
  const [dateFrom, setDateFrom] = useState<string>(thisYearFrom());
  const [dateTo, setDateTo] = useState<string>(today());

  // 컬럼 선택
  const [selected, setSelected] = useState<Set<ColName>>(new Set(DEFAULT_SELECTED));
  const [exporting, setExporting] = useState(false);

  // partner_id → salesperson 매핑 (입금자/영업제휴사 컬럼용)
  const partnerToSp = useMemo(() => {
    const m = new Map<string, Salesperson>();
    salespeople.forEach(s => (s.partner_ids || []).forEach(pid => m.set(pid, s)));
    return m;
  }, [salespeople]);

  // 채권사 ID → 이름
  const creditorMap = useMemo(() => {
    const m = new Map<string, string>();
    creditors.forEach(c => m.set(c.id, c.name));
    return m;
  }, [creditors]);

  // 필터 옵션 목록
  const distributorOptions = useMemo(() => {
    const s = new Set<string>();
    contracts.forEach(c => { if (c.distributor_name) s.add(c.distributor_name); });
    return Array.from(s).sort();
  }, [contracts]);
  const lesseeOptions = useMemo(() => {
    const s = new Set<string>();
    contracts.forEach(c => { if (c.lessee_name) s.add(c.lessee_name); });
    return Array.from(s).sort();
  }, [contracts]);
  const deviceOptions = useMemo(() => {
    const s = new Set<string>();
    contracts.forEach(c => { if (c.device_name) s.add(c.device_name); });
    return Array.from(s).sort();
  }, [contracts]);

  // 필터 적용된 contracts
  const filtered = useMemo(() => {
    return contracts.filter(c => {
      if (distributor && c.distributor_name !== distributor) return false;
      if (lessee && c.lessee_name !== lessee) return false;
      if (creditorId && (c as any).creditor_id !== creditorId) return false;
      if (device && c.device_name !== device) return false;
      if (statusF && c.status !== statusF) return false;
      if (salesId) {
        const sp = c.partner_id ? partnerToSp.get(c.partner_id) : undefined;
        if (!sp || sp.id !== salesId) return false;
      }
      // 기간 필터
      if (dateFrom || dateTo) {
        const v = (c as any)[dateBasis] as string | null | undefined;
        if (!v) return false;
        if (dateFrom && v < dateFrom) return false;
        if (dateTo && v > dateTo) return false;
      }
      return true;
    });
  }, [contracts, distributor, lessee, salesId, creditorId, device, statusF, dateBasis, dateFrom, dateTo, partnerToSp]);

  const toggleCol = (col: ColName) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(col)) n.delete(col); else n.add(col);
      return n;
    });
  };
  const selectAll = () => setSelected(new Set(ALL_COLS));
  const clearAll = () => setSelected(new Set());

  // 컬럼별 값 계산
  const cellValue = (c: Contract, col: ColName): any => {
    const sp = c.partner_id ? partnerToSp.get(c.partner_id) : undefined;
    switch (col) {
      case '계약번호1': return c.contract_number ?? '';
      case '계약번호2': return '';
      case '계약번호3': return '';
      case '계약자(라이더)': return c.lessee_name || '';
      case '총판': return c.distributor_name || '';
      case '보증인': return '';
      case '입금자': {
        if (!sp) return '';
        const parts = [sp.name];
        (sp.bank_aliases || []).forEach(a => { if (a && a !== sp.name) parts.push(a); });
        return parts.join(', ');
      }
      case '영업제휴사': return sp?.name || '';
      case '채권사': return (c as any).creditor_id ? (creditorMap.get((c as any).creditor_id) || '') : '';
      case '상품명': return c.device_name || '';
      case '수량': return Number(c.units_required) || 1;
      case '총채권금액': return Number(c.total_amount) || 0;
      case '총원가금액': {
        const cost = Number((c as any).procurement_cost) || 0;
        const units = Number(c.units_required) || 1;
        return cost * units;
      }
      case '계약일': return c.contract_date || '';
      case '계약실행일': return c.execution_date || '';
      case '계약종료일': return c.expiry_date || '';
      case '회수실행일': return c.execution_date || '';
      case '회수종료일': return c.expiry_date || '';
    }
  };

  const handleExport = async () => {
    if (exporting || filtered.length === 0 || selected.size === 0) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx-js-style');
      const headers = ALL_COLS.filter(c => selected.has(c));
      // 1행 [계약정보] 머지, 2행 헤더, 3행~ 데이터
      const aoa: any[][] = [
        ['[계약정보]', ...Array(Math.max(0, headers.length - 1)).fill(null)],
        headers as unknown as string[],
        ...filtered.map(c => headers.map(h => cellValue(c, h))),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // 1행 머지
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, headers.length - 1) } }];

      // 스타일
      const titleStyle = {
        font: { bold: true, sz: 13, color: { rgb: '7F6000' } },
        fill: { fgColor: { rgb: 'FFF2CC' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        border: { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      };
      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4472C4' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      };
      // 1행
      for (let c = 0; c < headers.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[addr]) ws[addr].s = titleStyle;
      }
      // 2행
      for (let c = 0; c < headers.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 1, c });
        if (ws[addr]) ws[addr].s = headerStyle;
      }
      // 숫자 컬럼 천단위 콤마 (수량/금액류)
      const numericCols = new Set<string>(['수량', '총채권금액', '총원가금액']);
      for (let r = 2; r < aoa.length; r++) {
        headers.forEach((h, i) => {
          if (!numericCols.has(h)) return;
          const addr = XLSX.utils.encode_cell({ r, c: i });
          if (ws[addr] && typeof ws[addr].v === 'number') ws[addr].z = '#,##0';
        });
      }
      // 컬럼 너비
      ws['!cols'] = headers.map(h => {
        if (h === '계약자(라이더)' || h === '총판' || h === '입금자' || h === '영업제휴사') return { wch: 14 };
        if (h === '상품명') return { wch: 24 };
        if (h === '채권사') return { wch: 16 };
        if (h.includes('금액')) return { wch: 14 };
        if (h.includes('일')) return { wch: 12 };
        return { wch: 12 };
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '계약마스터');
      const fname = `계약마스터_${todayYY()}_${filtered.length}건.xlsx`;
      XLSX.writeFile(wb, fname);
      onClose();
    } catch (e: any) {
      alert('엑셀 생성 실패: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !exporting && onClose()}>
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[820px] max-w-[95vw] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-white font-semibold text-lg">📥 계약 마스터 엑셀 생성</h3>
          <button onClick={onClose} disabled={exporting} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* 필터 조건 */}
        <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
          <h4 className="text-sm text-slate-300 font-medium mb-3">필터 조건 (선택)</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <FilterSelect label="총판" value={distributor} onChange={setDistributor} options={distributorOptions} />
            <FilterSelect label="계약자" value={lessee} onChange={setLessee} options={lesseeOptions} />
            <FilterSelect label="영업제휴사" value={salesId} onChange={setSalesId}
              options={salespeople.map(s => ({ value: s.id, label: s.name }))} />
            <FilterSelect label="채권사" value={creditorId} onChange={setCreditorId}
              options={creditors.map(c => ({ value: c.id, label: c.name }))} />
            <FilterSelect label="상품명" value={device} onChange={setDevice} options={deviceOptions} />
            <FilterSelect label="계약 상태" value={statusF} onChange={setStatusF}
              options={Object.values(ContractStatus).map(s => ({ value: s, label: s }))} />
          </div>
        </div>

        {/* 기간 필터 */}
        <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
          <h4 className="text-sm text-slate-300 font-medium mb-3">기간 필터 (선택)</h4>
          <div className="flex items-center gap-2 text-sm">
            <select value={dateBasis} onChange={e => setDateBasis(e.target.value as DateBasis)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white">
              <option value="contract_date">계약일 기준</option>
              <option value="execution_date">계약실행일 기준</option>
              <option value="expiry_date">계약종료일 기준</option>
            </select>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white" />
            <span className="text-slate-400">~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white" />
          </div>
        </div>

        {/* 컬럼 선택 */}
        <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="text-sm text-slate-300 font-medium">포함 컬럼 {selected.size} / {ALL_COLS.length} 선택</h4>
            <div className="flex gap-2 text-xs">
              <button onClick={selectAll} className="text-emerald-400 hover:text-emerald-300">전체 선택</button>
              <span className="text-slate-600">/</span>
              <button onClick={clearAll} className="text-slate-400 hover:text-white">전체 해제</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_COLS.map(col => {
              const on = selected.has(col);
              return (
                <button key={col} onClick={() => toggleCol(col)}
                  className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                    on
                      ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-slate-700/50 border-slate-600 text-slate-400 hover:text-white'
                  }`}>
                  {on ? '✓ ' : ''}{col}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">※ 기본값: 17/18 컬럼 선택 (보증인은 시스템 데이터 없어 기본 해제)</p>
        </div>

        {/* 액션 */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-700">
          <div className="text-sm text-slate-400">
            예상 추출: <span className="text-white font-semibold">{filtered.length}건</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={exporting}
              className="text-sm px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50">취소</button>
            <button onClick={handleExport} disabled={exporting || filtered.length === 0 || selected.size === 0}
              className="text-sm px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
              📥 {exporting ? '생성 중...' : '생성 후 다운로드'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── 필터 셀렉트 ───
const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
}> = ({ label, value, onChange, options }) => (
  <div>
    <label className="text-xs text-slate-400 mb-1 block">{label}</label>
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-white">
      <option value="">전체</option>
      {options.map(o => {
        if (typeof o === 'string') return <option key={o} value={o}>{o}</option>;
        return <option key={o.value} value={o.value}>{o.label}</option>;
      })}
    </select>
  </div>
);
