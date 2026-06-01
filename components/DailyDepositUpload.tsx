import React, { useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/utils';

interface Salesperson {
  id: string;
  name: string;
  bank_aliases?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;  // 업로드 완료 후 부모 새로고침
  salespeople: Salesperson[];
}

interface ParsedRow {
  date: string;
  depositor: string;
  amount: number;
  salesperson_id: string | null;  // 자동 매칭 결과 (표시용)
}

// 엑셀 셀 → 날짜 문자열 (YYYY-MM-DD)
function toDateString(v: any): string {
  if (!v) return '';
  if (typeof v === 'number') {
    // Excel serial date
    const d = new Date((v - 25569) * 86400 * 1000);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // 이미 YYYY-MM-DD 또는 YYYY/MM/DD 등
  const m = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, '0');
    const d = m[3].padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return s;
}

function toNumber(v: any): number {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const s = String(v).replace(/[^\d.-]/g, '');
  return Number(s) || 0;
}

// 영업자 자동 매칭: name + bank_aliases, 양방향 부분 매칭 (BankDepositUpload와 동일 방식)
// 우선순위: 정확 일치 → 양방향 부분 매칭 (name 또는 alias)
function matchSalesperson(depositor: string, salespeople: Salesperson[]): string | null {
  const dep = (depositor || '').trim().toLowerCase();
  if (!dep) return null;
  // 1) 정확 일치
  for (const sp of salespeople) {
    const name = (sp.name || '').trim().toLowerCase();
    if (name && name === dep) return sp.id;
    for (const a of sp.bank_aliases || []) {
      const al = (a || '').trim().toLowerCase();
      if (al && al === dep) return sp.id;
    }
  }
  // 2) 양방향 부분 매칭 — '조성현' ↔ '조성현(생각대로)' 같은 어바웃 매칭
  for (const sp of salespeople) {
    const name = (sp.name || '').trim().toLowerCase();
    if (name && (dep.includes(name) || name.includes(dep))) return sp.id;
    for (const a of sp.bank_aliases || []) {
      const al = (a || '').trim().toLowerCase();
      if (al && (dep.includes(al) || al.includes(dep))) return sp.id;
    }
  }
  return null;
}

export const DailyDepositUpload: React.FC<Props> = ({ open, onClose, onUploaded, salespeople }) => {
  const [fileName, setFileName] = useState<string>('');
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [headerIdx, setHeaderIdx] = useState<number>(0);
  const [colDate, setColDate] = useState<number>(-1);
  const [colDepositor, setColDepositor] = useState<number>(-1);
  const [colAmount, setColAmount] = useState<number>(-1);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFileName('');
    setRawRows([]);
    setHeaderIdx(0);
    setColDate(-1);
    setColDepositor(-1);
    setColAmount(-1);
  };

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    const { read, utils } = await import('xlsx-js-style');
    const buf = await file.arrayBuffer();
    const wb = read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = utils.sheet_to_json(sheet, { header: 1, raw: true });
    setRawRows(rows);
    // 헤더 자동 추론: '입금자' 또는 '거래일' 같은 키워드 포함 행 찾기
    let hi = 0;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i] || [];
      const text = r.map(c => String(c || '')).join('|');
      if (/입금자|거래일|날짜|입금액|금액/.test(text)) { hi = i; break; }
    }
    setHeaderIdx(hi);
    // 컬럼 자동 추론
    const header = (rows[hi] || []).map((c: any) => String(c || ''));
    let cd = -1, cdep = -1, camt = -1;
    header.forEach((h, idx) => {
      if (cd === -1 && /(거래|입금|날짜|일자|deposit)/i.test(h)) cd = idx;
      if (cdep === -1 && /(입금자|보낸이|메모|적요|예금주|sender)/i.test(h)) cdep = idx;
      if (camt === -1 && /(금액|입금액|amount)/i.test(h)) camt = idx;
    });
    setColDate(cd);
    setColDepositor(cdep);
    setColAmount(camt);
  }, []);

  // 파싱된 행
  const parsed = useMemo<ParsedRow[]>(() => {
    if (rawRows.length === 0 || colDate < 0 || colAmount < 0) return [];
    const out: ParsedRow[] = [];
    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (!r) continue;
      const date = toDateString(r[colDate]);
      const depositor = colDepositor >= 0 ? String(r[colDepositor] || '').trim() : '';
      const amount = toNumber(r[colAmount]);
      if (!date || !amount) continue;  // 빈 행/입금 외 행 제외
      if (amount <= 0) continue;
      const salesperson_id = matchSalesperson(depositor, salespeople);
      out.push({ date, depositor, amount, salesperson_id });
    }
    return out;
  }, [rawRows, headerIdx, colDate, colDepositor, colAmount, salespeople]);

  const matchedCount = parsed.filter(p => p.salesperson_id).length;

  const handleSave = async () => {
    if (!supabase || saving || parsed.length === 0) return;
    setSaving(true);
    try {
      // batch_id 생성 (한 번에 같이 들어간 행 묶음)
      const batchId = crypto.randomUUID();
      const rows = parsed.map(p => ({
        deposit_date: p.date,
        depositor_name: p.depositor || null,
        amount: p.amount,
        salesperson_id: p.salesperson_id,
        batch_id: batchId,
      }));
      // 1000개씩 청크
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const { error } = await (supabase.from('daily_bank_deposits') as any).insert(chunk);
        if (error) throw error;
      }
      alert(`${parsed.length}건 업로드 완료\n(영업자 매칭: ${matchedCount}건)`);
      reset();
      onUploaded();
      onClose();
    } catch (e: any) {
      alert('업로드 실패: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !saving && onClose()}>
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[760px] max-w-[95vw] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-white font-semibold text-lg">은행 입금내역 업로드 (일별 보고용)</h3>
            <p className="text-xs text-slate-400 mt-1">
              daily_bank_deposits 전용 — 분배 로직 없이 raw 행만 저장. 회수관리 bank_deposits와 별개.
            </p>
          </div>
          <button onClick={onClose} disabled={saving} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* 파일 선택 */}
        <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
          <label className="block cursor-pointer">
            <div className="border-2 border-dashed border-slate-600 hover:border-indigo-500 rounded-lg p-6 text-center transition-colors">
              {fileName ? (
                <div>
                  <p className="text-sm text-emerald-400">📄 {fileName}</p>
                  <p className="text-xs text-slate-500 mt-1">파일 변경하려면 다시 클릭</p>
                </div>
              ) : (
                <>
                  <p className="text-slate-300 text-sm">엑셀(.xlsx) 파일을 클릭해서 선택</p>
                  <p className="text-slate-500 text-xs mt-1">첫 시트만 읽음</p>
                </>
              )}
            </div>
            <input type="file" accept=".xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </label>
        </div>

        {/* 컬럼 매핑 */}
        {rawRows.length > 0 && (
          <div className="bg-slate-900/50 rounded-lg p-4 mb-4 space-y-3">
            <h4 className="text-white text-sm font-medium">컬럼 매핑</h4>
            <div className="flex items-center gap-2 text-sm">
              <label className="text-xs text-slate-400 w-24">헤더 행</label>
              <input type="number" value={headerIdx} min={0}
                onChange={e => setHeaderIdx(Number(e.target.value) || 0)}
                className="bg-slate-700 border border-slate-600 rounded px-2 py-1 w-20 text-white" />
              <span className="text-xs text-slate-500">(0부터 — 자동 추론됨)</span>
            </div>
            <ColumnPicker label="날짜 컬럼" value={colDate} onChange={setColDate} header={rawRows[headerIdx] || []} />
            <ColumnPicker label="입금자 컬럼" value={colDepositor} onChange={setColDepositor} header={rawRows[headerIdx] || []} optional />
            <ColumnPicker label="금액 컬럼" value={colAmount} onChange={setColAmount} header={rawRows[headerIdx] || []} />
          </div>
        )}

        {/* 미리보기 */}
        {parsed.length > 0 && (
          <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-white text-sm font-medium">미리보기 ({parsed.length}건 · 영업자 매칭 {matchedCount}건)</h4>
              <span className="text-xs text-slate-400">총 ₩{formatCurrency(parsed.reduce((s, p) => s + p.amount, 0))}</span>
            </div>
            <div className="max-h-72 overflow-y-auto bg-slate-900 rounded border border-slate-700">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-slate-400 sticky top-0">
                  <tr><th className="p-2 text-left">날짜</th><th className="p-2 text-left">입금자</th><th className="p-2 text-left">영업자</th><th className="p-2 text-right">금액</th></tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 200).map((p, i) => {
                    const sp = salespeople.find(s => s.id === p.salesperson_id);
                    return (
                      <tr key={i} className="border-t border-slate-700/50">
                        <td className="p-2 text-slate-300">{p.date}</td>
                        <td className="p-2 text-white">{p.depositor || '-'}</td>
                        <td className="p-2 text-slate-300">{sp ? sp.name : <span className="text-red-400">미매칭</span>}</td>
                        <td className="p-2 text-right text-emerald-400">₩{formatCurrency(p.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {parsed.length > 200 && <p className="text-xs text-slate-500 p-2">... +{parsed.length - 200}건 (저장 시 모두 처리)</p>}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className="text-sm px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50">취소</button>
          <button onClick={handleSave} disabled={saving || parsed.length === 0}
            className="text-sm px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
            {saving ? '저장 중...' : `저장 (${parsed.length}건)`}
          </button>
        </div>
      </div>
    </div>
  );
};

const ColumnPicker: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  header: any[];
  optional?: boolean;
}> = ({ label, value, onChange, header, optional }) => (
  <div className="flex items-center gap-2 text-sm">
    <label className="text-xs text-slate-400 w-24">{label}{optional && <span className="text-slate-500 text-[10px]"> (선택)</span>}</label>
    <select value={value} onChange={e => onChange(Number(e.target.value))}
      className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white flex-1">
      <option value={-1}>{optional ? '— 사용 안 함 —' : '— 선택 —'}</option>
      {header.map((h, i) => <option key={i} value={i}>{i}: {String(h || '(빈 컬럼)')}</option>)}
    </select>
  </div>
);
