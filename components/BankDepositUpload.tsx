import React, { useState, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Contract, Partner, Salesperson, CreditorSettlementRound } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';

interface Props {
  contracts: Contract[];
  partners: Partner[];
  salespeople: Salesperson[];
  settlements: CreditorSettlementRound[];
  onProcessed: () => void;
}

interface ParsedDeposit {
  rowIdx: number;
  date: string;
  depositor: string;
  amount: number;
  matchedSalespersonId: string | null;
  matchedSalespersonName: string;
  expectedAmount: number; // 해당 영업자의 입금일까지 누적 미납액
  diff: number;
  status: 'matched' | 'partial' | 'unmatched';
}

export const BankDepositUpload: React.FC<Props> = ({ contracts, partners, salespeople, settlements, onProcessed }) => {
  const [excelData, setExcelData] = useState<any[][] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [dateCol, setDateCol] = useState<number>(-1);
  const [depositorCol, setDepositorCol] = useState<number>(-1);
  const [amountCol, setAmountCol] = useState<number>(-1);
  const [parsed, setParsed] = useState<ParsedDeposit[]>([]);
  const [processing, setProcessing] = useState(false);
  const [presetName, setPresetName] = useState('');

  const partnerById = useMemo(() => new Map(partners.map(p => [p.id, p])), [partners]);

  // 영업자 매칭 (이름 또는 별칭 정확히/부분 매칭)
  const findSalesperson = (depositor: string): Salesperson | null => {
    const norm = depositor.trim();
    for (const sp of salespeople) {
      if (sp.name === norm) return sp;
      if ((sp.bank_aliases || []).includes(norm)) return sp;
    }
    // 부분 매칭 (입금자명에 영업자명 포함)
    for (const sp of salespeople) {
      if (norm.includes(sp.name) || sp.name.includes(norm)) return sp;
      for (const a of sp.bank_aliases || []) {
        if (norm.includes(a) || a.includes(norm)) return sp;
      }
    }
    return null;
  };

  // 영업자의 담당 파트너사 → 계약들 → 일자별 미납액 누적
  const calcExpectedAmount = (sp: Salesperson, asOfDate: string): number => {
    const partnerSet = new Set(sp.partner_ids);
    const targetContracts = contracts.filter(c => c.partner_id && partnerSet.has(c.partner_id) && c.status === '진행중');
    let total = 0;
    for (const c of targetContracts) {
      const ded = c.daily_deductions || [];
      for (const d of ded) {
        if (d.date <= asOfDate && d.status !== '납부완료') {
          total += (Number(d.amount) || 0) - (Number(d.paid_amount) || 0);
        }
      }
    }
    return total;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { read, utils } = await import('xlsx-js-style');
    const buf = await file.arrayBuffer();
    const wb = read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];
    setExcelData(rows);
    setParsed([]);
    setDateCol(-1); setDepositorCol(-1); setAmountCol(-1); setHeaderRow(0);
  };

  const headers = useMemo(() => excelData?.[headerRow] || [], [excelData, headerRow]);

  const parseDeposits = () => {
    if (!excelData || dateCol < 0 || depositorCol < 0 || amountCol < 0) {
      alert('컬럼을 모두 선택해주세요.');
      return;
    }
    const list: ParsedDeposit[] = [];
    for (let i = headerRow + 1; i < excelData.length; i++) {
      const row = excelData[i];
      if (!row || !row[depositorCol]) continue;

      let dateStr = '';
      const rawDate = row[dateCol];
      if (rawDate instanceof Date) {
        const d = rawDate;
        dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      } else if (typeof rawDate === 'string') {
        const m = rawDate.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
        if (m) dateStr = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        else dateStr = rawDate;
      } else if (typeof rawDate === 'number') {
        // 엑셀 시리얼
        const d = new Date((rawDate - 25569) * 86400 * 1000);
        dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      const depositor = String(row[depositorCol] || '').trim();
      const amountRaw = String(row[amountCol] || '0').replace(/[,\s원]/g, '');
      const amount = Number(amountRaw) || 0;
      if (amount <= 0 || !depositor) continue;

      const sp = findSalesperson(depositor);
      const expected = sp ? calcExpectedAmount(sp, dateStr) : 0;
      const diff = amount - expected;
      let status: 'matched' | 'partial' | 'unmatched' = 'unmatched';
      if (sp) {
        if (Math.abs(diff) < 1) status = 'matched';
        else status = 'partial';
      }

      list.push({
        rowIdx: i,
        date: dateStr,
        depositor,
        amount,
        matchedSalespersonId: sp?.id || null,
        matchedSalespersonName: sp?.name || '',
        expectedAmount: expected,
        diff,
        status,
      });
    }
    setParsed(list);
  };

  const savePreset = async () => {
    if (!supabase || !presetName.trim()) { alert('프리셋 이름을 입력하세요.'); return; }
    if (dateCol < 0 || depositorCol < 0 || amountCol < 0) { alert('컬럼을 모두 선택하세요.'); return; }
    await (supabase.from('bank_excel_presets') as any).insert({
      name: presetName.trim(),
      date_column: String(headers[dateCol] || dateCol),
      depositor_column: String(headers[depositorCol] || depositorCol),
      amount_column: String(headers[amountCol] || amountCol),
      header_row: headerRow,
    });
    alert('프리셋 저장 완료');
    setPresetName('');
  };

  // 자동 분배 처리
  const handleProcess = async () => {
    if (!supabase) return;
    const matched = parsed.filter(p => p.matchedSalespersonId);
    if (matched.length === 0) { alert('매칭된 입금이 없습니다.'); return; }
    if (!confirm(`${matched.length}건 입금을 자동 분배 처리하시겠습니까?`)) return;

    setProcessing(true);
    try {
      // 1) 영업자별로 입금 합계 계산 (한 영업자가 같은 날 여러 건 입금 시 합산해서 처리)
      const grouped = new Map<string, { sp: Salesperson; totalAmount: number; deposits: ParsedDeposit[] }>();
      for (const p of matched) {
        const sp = salespeople.find(s => s.id === p.matchedSalespersonId);
        if (!sp) continue;
        const cur = grouped.get(p.matchedSalespersonId!) || { sp, totalAmount: 0, deposits: [] };
        cur.totalAmount += p.amount;
        cur.deposits.push(p);
        grouped.set(p.matchedSalespersonId!, cur);
      }

      // 2) 영업자별로 미납 차감분에 분배
      const contractUpdates = new Map<string, any[]>();
      for (const [_, { sp, totalAmount, deposits }] of grouped) {
        let remaining = totalAmount;
        const partnerSet = new Set(sp.partner_ids);
        // 해당 영업자의 모든 계약 중 진행중인 것들 → 일자순 정렬
        const targetContracts = contracts.filter(c => c.partner_id && partnerSet.has(c.partner_id) && c.status === '진행중');

        // 모든 차감을 (계약, 차감) 쌍으로 펼친 뒤 날짜순 정렬
        type DedRef = { contractId: string; dedIdx: number; date: string; amount: number; paid: number; status: string };
        const allDeds: DedRef[] = [];
        for (const c of targetContracts) {
          const ded = c.daily_deductions || [];
          ded.forEach((d, idx) => {
            if (d.status !== '납부완료') {
              allDeds.push({
                contractId: c.id, dedIdx: idx, date: d.date,
                amount: Number(d.amount) || 0, paid: Number(d.paid_amount) || 0, status: d.status
              });
            }
          });
        }
        allDeds.sort((a, b) => a.date.localeCompare(b.date));

        // 입금일 이전의 미납분에 우선 배분
        const maxDate = deposits.reduce((m, d) => d.date > m ? d.date : m, '');
        for (const dr of allDeds) {
          if (remaining <= 0) break;
          if (maxDate && dr.date > maxDate) break; // 입금일 이후는 처리 안 함
          const owed = dr.amount - dr.paid;
          if (owed <= 0) continue;
          const payment = Math.min(remaining, owed);
          remaining -= payment;
          // contractUpdates에 누적
          const existing = contractUpdates.get(dr.contractId) || [...(contracts.find(c => c.id === dr.contractId)?.daily_deductions || [])];
          const newPaid = existing[dr.dedIdx].paid_amount + payment;
          existing[dr.dedIdx] = {
            ...existing[dr.dedIdx],
            paid_amount: newPaid,
            status: newPaid >= existing[dr.dedIdx].amount ? '납부완료' : '부분납부',
          };
          contractUpdates.set(dr.contractId, existing);
        }

        // 3) bank_deposits 테이블에 기록
        for (const dep of deposits) {
          await (supabase.from('bank_deposits') as any).insert({
            deposit_date: dep.date,
            depositor_name: dep.depositor,
            amount: dep.amount,
            salesperson_id: dep.matchedSalespersonId,
            status: dep.status,
            matched_amount: dep.amount - (remaining > 0 ? Math.min(remaining, dep.amount) : 0),
            remaining_amount: remaining > 0 ? Math.min(remaining, dep.amount) : 0,
            processed_at: new Date().toISOString(),
          });
        }
      }

      // 4) 계약 daily_deductions 일괄 업데이트
      for (const [contractId, deds] of contractUpdates) {
        await (supabase.from('contracts') as any).update({ daily_deductions: deds }).eq('id', contractId);
      }

      // 5) 매칭 안 된 건도 기록
      for (const p of parsed.filter(p => !p.matchedSalespersonId)) {
        await (supabase.from('bank_deposits') as any).insert({
          deposit_date: p.date,
          depositor_name: p.depositor,
          amount: p.amount,
          salesperson_id: null,
          status: 'unmatched',
          matched_amount: 0,
          remaining_amount: p.amount,
        });
      }

      alert(`처리 완료: ${matched.length}건 자동 분배, ${parsed.length - matched.length}건 미매칭 기록`);
      setParsed([]);
      setExcelData(null);
      onProcessed();
    } catch (e: any) {
      alert(`처리 실패: ${e.message}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h3 className="text-white font-bold mb-3">은행 입금내역 업로드</h3>

        {!excelData ? (
          <label className="flex items-center justify-center bg-slate-700 hover:bg-slate-600 transition-colors text-white rounded-lg px-4 py-8 cursor-pointer border-2 border-dashed border-slate-600">
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
            <span>📁 엑셀 파일 선택 (입금내역)</span>
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">총 {excelData.length}행</span>
              <button onClick={() => { setExcelData(null); setParsed([]); }} className="text-xs text-red-400 hover:text-red-300">파일 변경</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">헤더 행 번호 (0부터 시작)</label>
                <input type="number" min={0} value={headerRow} onChange={e => setHeaderRow(Number(e.target.value))}
                  className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">프리셋 저장 (선택)</label>
                <div className="flex gap-1">
                  <input type="text" value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="예: 신한은행"
                    className="flex-1 bg-slate-700 text-white rounded px-2 py-1 text-sm" />
                  <button onClick={savePreset} className="bg-slate-600 hover:bg-slate-700 text-white text-xs px-2 rounded">저장</button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">입금일 컬럼</label>
                <select value={dateCol} onChange={e => setDateCol(Number(e.target.value))} className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm">
                  <option value={-1}>선택...</option>
                  {headers.map((h: any, i: number) => <option key={i} value={i}>{i}: {String(h || '').slice(0, 30)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">입금자명 컬럼</label>
                <select value={depositorCol} onChange={e => setDepositorCol(Number(e.target.value))} className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm">
                  <option value={-1}>선택...</option>
                  {headers.map((h: any, i: number) => <option key={i} value={i}>{i}: {String(h || '').slice(0, 30)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">금액 컬럼</label>
                <select value={amountCol} onChange={e => setAmountCol(Number(e.target.value))} className="w-full bg-slate-700 text-white rounded px-2 py-1 text-sm">
                  <option value={-1}>선택...</option>
                  {headers.map((h: any, i: number) => <option key={i} value={i}>{i}: {String(h || '').slice(0, 30)}</option>)}
                </select>
              </div>
            </div>

            <button onClick={parseDeposits} disabled={dateCol < 0 || depositorCol < 0 || amountCol < 0}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg">
              미리보기 분석
            </button>
          </div>
        )}
      </div>

      {/* 분석 결과 */}
      {parsed.length > 0 && (
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-white font-bold">분석 결과 ({parsed.length}건)</h3>
            <div className="text-xs text-slate-400">
              매칭 {parsed.filter(p => p.status === 'matched').length} ·
              부분 {parsed.filter(p => p.status === 'partial').length} ·
              미매칭 {parsed.filter(p => p.status === 'unmatched').length}
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto border border-slate-700 rounded">
            <table className="w-full text-xs">
              <thead className="bg-slate-700/50 sticky top-0">
                <tr>
                  <th className="p-2 text-left text-slate-400">입금일</th>
                  <th className="p-2 text-left text-slate-400">입금자명</th>
                  <th className="p-2 text-right text-slate-400">금액</th>
                  <th className="p-2 text-left text-slate-400">매칭 영업자</th>
                  <th className="p-2 text-right text-slate-400">예상 미납</th>
                  <th className="p-2 text-right text-slate-400">차액</th>
                  <th className="p-2 text-center text-slate-400">상태</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map(p => (
                  <tr key={p.rowIdx} className="border-t border-slate-700">
                    <td className="p-2 text-slate-300">{p.date}</td>
                    <td className="p-2 text-white">{p.depositor}</td>
                    <td className="p-2 text-right text-slate-200">{formatCurrency(p.amount)}</td>
                    <td className="p-2 text-slate-300">{p.matchedSalespersonName || <span className="text-red-400">미매칭</span>}</td>
                    <td className="p-2 text-right text-slate-400">{p.expectedAmount > 0 ? formatCurrency(p.expectedAmount) : '-'}</td>
                    <td className={`p-2 text-right ${p.diff === 0 ? 'text-green-400' : p.diff > 0 ? 'text-blue-400' : 'text-yellow-400'}`}>
                      {p.matchedSalespersonId ? (p.diff === 0 ? '일치' : formatCurrency(p.diff)) : '-'}
                    </td>
                    <td className="p-2 text-center">
                      {p.status === 'matched' ? <span className="bg-green-500/20 text-green-300 px-2 py-0.5 rounded">일치</span> :
                       p.status === 'partial' ? <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded">차액</span> :
                       <span className="bg-red-500/20 text-red-300 px-2 py-0.5 rounded">미매칭</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setParsed([])} className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded">취소</button>
            <button onClick={handleProcess} disabled={processing}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded">
              {processing ? '처리 중...' : '자동 분배 처리'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
