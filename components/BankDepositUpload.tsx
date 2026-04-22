import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
  expectedAmount: number;
  diff: number;
  status: 'matched' | 'partial' | 'unmatched' | 'duplicate';
  isDuplicate?: boolean;
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
  const [parsing, setParsing] = useState(false);
  const xlsxRef = useRef<any>(null);

  // xlsx는 파일 선택 후 처음 사용할 때만 로드

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
  // 실행일이 도래하지 않은 계약은 제외, 만료일 지난 차감도 제외
  const calcExpectedAmount = (sp: Salesperson, asOfDate: string): number => {
    const partnerSet = new Set(sp.partner_ids);
    const targetContracts = contracts.filter(c =>
      c.partner_id && partnerSet.has(c.partner_id) &&
      c.status === '진행중' &&
      (!c.execution_date || c.execution_date <= asOfDate)
    );
    let total = 0;
    for (const c of targetContracts) {
      const ded = c.daily_deductions || [];
      for (const d of ded) {
        // 실행일~만료일 범위 내 차감만
        if (c.execution_date && d.date < c.execution_date) continue;
        if (c.expiry_date && d.date > c.expiry_date) continue;
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
    setParsing(true);
    try {
      // xlsx 라이브러리 (이미 mount 시 로드됐을 가능성 높음)
      const xlsx = xlsxRef.current || (await import('xlsx-js-style'));
      xlsxRef.current = xlsx;
      const buf = await file.arrayBuffer();
      const wb = xlsx.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];
      setExcelData(rows);
      setParsed([]);
      setDateCol(-1); setDepositorCol(-1); setAmountCol(-1); setHeaderRow(0);
    } finally {
      setParsing(false);
    }
  };

  const headers = useMemo(() => excelData?.[headerRow] || [], [excelData, headerRow]);

  const parseDeposits = async () => {
    if (!excelData || dateCol < 0 || depositorCol < 0 || amountCol < 0) {
      alert('컬럼을 모두 선택해주세요.');
      return;
    }

    // 1) 기존 처리된 입금 조회 (중복 체크용) - reverted_at IS NULL인 것만
    const existingKeys = new Set<string>();
    if (supabase) {
      const { data } = await (supabase.from('bank_deposits') as any)
        .select('deposit_date, depositor_name, amount')
        .is('reverted_at', null);
      (data || []).forEach((d: any) => {
        existingKeys.add(`${d.deposit_date}|${d.depositor_name}|${Number(d.amount)}`);
      });
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

      // 중복 체크
      const dupKey = `${dateStr}|${depositor}|${amount}`;
      const isDup = existingKeys.has(dupKey);

      const sp = findSalesperson(depositor);
      const expected = sp ? calcExpectedAmount(sp, dateStr) : 0;
      const diff = amount - expected;
      let status: 'matched' | 'partial' | 'unmatched' | 'duplicate' = 'unmatched';
      if (isDup) {
        status = 'duplicate';
      } else if (sp) {
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
        isDuplicate: isDup,
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

  // 자동 분배 처리 (안전한 백업 + 롤백 + 중복 스킵 + 선납 처리)
  const handleProcess = async () => {
    if (!supabase) return;
    // 중복 제외, 매칭된 것만
    const dupCount = parsed.filter(p => p.isDuplicate).length;
    const matched = parsed.filter(p => p.matchedSalespersonId && !p.isDuplicate);
    if (matched.length === 0) {
      alert(dupCount > 0 ? `처리 가능한 입금이 없습니다. (중복 ${dupCount}건 자동 스킵)` : '매칭된 입금이 없습니다.');
      return;
    }

    // 영업자별로 미납 + 초과 계산 (선납 여부 사전 확인)
    const overflows: { spName: string; overflowAmount: number }[] = [];
    for (const p of matched) {
      const sp = salespeople.find(s => s.id === p.matchedSalespersonId);
      if (!sp) continue;
      const expected = calcExpectedAmount(sp, p.date);
      // 같은 영업자의 같은 날 다른 입금 합산은 단순화: 개별 처리
      if (p.amount > expected) {
        overflows.push({ spName: sp.name, overflowAmount: p.amount - expected });
      }
    }

    let allowPrepay = false;
    if (overflows.length > 0) {
      const total = overflows.reduce((s, o) => s + o.overflowAmount, 0);
      const detail = overflows.slice(0, 5).map(o => `- ${o.spName}: ${formatCurrency(o.overflowAmount)} 초과`).join('\n');
      allowPrepay = confirm(
        `초과 입금이 ${overflows.length}건 발견됐습니다 (합계 ${formatCurrency(total)}).\n\n${detail}${overflows.length > 5 ? '\n...' : ''}\n\n초과액을 미래 차감일에 선납으로 처리할까요?\n\n[확인]: 선납 처리\n[취소]: 미래 차감 안 건드리고 미배분으로 남김`
      );
    }

    const confirmMsg = `${matched.length}건 입금을 자동 분배 처리합니다.${dupCount > 0 ? `\n(중복 ${dupCount}건 자동 스킵)` : ''}${overflows.length > 0 ? `\n초과액: ${allowPrepay ? '선납 처리' : '미배분'}` : ''}\n\n진행할까요?`;
    if (!confirm(confirmMsg)) return;

    setProcessing(true);
    const batchId = crypto.randomUUID();
    const insertedDepositIds: string[] = [];
    const updatedContractIds: string[] = [];

    try {
      // 1) 영업자별로 입금 합계 계산
      const grouped = new Map<string, { sp: Salesperson; totalAmount: number; deposits: ParsedDeposit[] }>();
      for (const p of matched) {
        const sp = salespeople.find(s => s.id === p.matchedSalespersonId);
        if (!sp) continue;
        const cur = grouped.get(p.matchedSalespersonId!) || { sp, totalAmount: 0, deposits: [] };
        cur.totalAmount += p.amount;
        cur.deposits.push(p);
        grouped.set(p.matchedSalespersonId!, cur);
      }

      // 2) 영업자별로 미납 차감분에 분배 (메모리 상에서만 계산, DB는 아직 안 건드림)
      // 입금일 기준으로 실행일 도래한 계약만 처리
      const contractUpdates = new Map<string, { before: any[]; after: any[] }>();
      for (const [_, { sp, totalAmount, deposits }] of grouped) {
        let remaining = totalAmount;
        const partnerSet = new Set(sp.partner_ids);
        const maxDepositDate = deposits.reduce((m, d) => d.date > m ? d.date : m, '');
        const targetContracts = contracts.filter(c =>
          c.partner_id && partnerSet.has(c.partner_id) &&
          c.status === '진행중' &&
          (!c.execution_date || c.execution_date <= maxDepositDate)
        );

        type DedRef = { contractId: string; dedIdx: number; date: string; amount: number; paid: number };
        const allDeds: DedRef[] = [];
        for (const c of targetContracts) {
          const ded = c.daily_deductions || [];
          ded.forEach((d, idx) => {
            if (d.status === '납부완료') return;
            // 실행일~만료일 범위 내만
            if (c.execution_date && d.date < c.execution_date) return;
            if (c.expiry_date && d.date > c.expiry_date) return;
            allDeds.push({
              contractId: c.id, dedIdx: idx, date: d.date,
              amount: Number(d.amount) || 0, paid: Number(d.paid_amount) || 0,
            });
          });
        }
        allDeds.sort((a, b) => a.date.localeCompare(b.date));

        for (const dr of allDeds) {
          if (remaining <= 0) break;
          // allowPrepay=false: 입금일 이후는 처리 안 함 (기존 동작)
          // allowPrepay=true: 미래 차감일도 처리 (선납)
          if (!allowPrepay && maxDepositDate && dr.date > maxDepositDate) break;
          const owed = dr.amount - dr.paid;
          if (owed <= 0) continue;
          const payment = Math.min(remaining, owed);
          remaining -= payment;

          // 백업(before) + 업데이트(after) 둘 다 보관
          let entry = contractUpdates.get(dr.contractId);
          if (!entry) {
            const orig = contracts.find(c => c.id === dr.contractId)?.daily_deductions || [];
            entry = { before: JSON.parse(JSON.stringify(orig)), after: JSON.parse(JSON.stringify(orig)) };
            contractUpdates.set(dr.contractId, entry);
          }
          const newPaid = entry.after[dr.dedIdx].paid_amount + payment;
          entry.after[dr.dedIdx] = {
            ...entry.after[dr.dedIdx],
            paid_amount: newPaid,
            status: newPaid >= entry.after[dr.dedIdx].amount ? '납부완료' : '부분납부',
          };
        }
      }

      // 3) DB 업데이트 시작 - 실패 시 롤백
      // 3-1) 모든 입금 기록 (matched + unmatched) 삽입 - 중복은 제외
      const allDepositRecords = [
        ...matched.map(p => ({
          deposit_date: p.date,
          depositor_name: p.depositor,
          amount: p.amount,
          salesperson_id: p.matchedSalespersonId,
          status: p.status,
          matched_amount: p.amount,
          remaining_amount: 0,
          processed_at: new Date().toISOString(),
          batch_id: batchId,
          contract_changes: null as any,
        })),
        ...parsed.filter(p => !p.matchedSalespersonId && !p.isDuplicate).map(p => ({
          deposit_date: p.date,
          depositor_name: p.depositor,
          amount: p.amount,
          salesperson_id: null,
          status: 'unmatched',
          matched_amount: 0,
          remaining_amount: p.amount,
          batch_id: batchId,
          contract_changes: null as any,
        })),
      ];

      // 첫 번째 입금 레코드에 contract_changes 백업 저장 (롤백용)
      const contractChanges = Array.from(contractUpdates.entries()).map(([contractId, { before }]) => ({
        contract_id: contractId,
        before_deductions: before,
      }));
      if (allDepositRecords.length > 0) {
        allDepositRecords[0].contract_changes = contractChanges;
      }

      const { data: insertedDeposits, error: depErr } = await (supabase.from('bank_deposits') as any).insert(allDepositRecords).select();
      if (depErr) throw new Error(`입금 기록 저장 실패: ${depErr.message}`);
      if (insertedDeposits) (insertedDeposits as any[]).forEach(d => insertedDepositIds.push(d.id));

      // 3-2) 계약 daily_deductions 업데이트
      for (const [contractId, { after }] of contractUpdates) {
        const { error } = await (supabase.from('contracts') as any).update({ daily_deductions: after }).eq('id', contractId);
        if (error) throw new Error(`계약 ${contractId} 업데이트 실패: ${error.message}`);
        updatedContractIds.push(contractId);
      }

      const unmatched = parsed.filter(p => !p.matchedSalespersonId && !p.isDuplicate).length;
      alert(`처리 완료\n- 분배: ${matched.length}건\n- 미매칭 기록: ${unmatched}건${dupCount > 0 ? `\n- 중복 스킵: ${dupCount}건` : ''}\n\n잘못 올렸으면 "📋 입금 이력" 버튼에서 일괄 취소할 수 있습니다.`);
      setParsed([]);
      setExcelData(null);
      onProcessed();
    } catch (e: any) {
      // 롤백: 이미 업데이트한 계약 + 삽입한 입금 기록 되돌리기
      console.error('처리 실패, 롤백 시작:', e);
      try {
        for (const cid of updatedContractIds) {
          const orig = contracts.find(c => c.id === cid)?.daily_deductions;
          if (orig) {
            await (supabase.from('contracts') as any).update({ daily_deductions: orig }).eq('id', cid);
          }
        }
        if (insertedDepositIds.length > 0) {
          await (supabase.from('bank_deposits') as any).delete().in('id', insertedDepositIds);
        }
        alert(`처리 실패 → 자동 롤백 완료\n원인: ${e.message}`);
      } catch (rollbackErr: any) {
        alert(`처리 실패 + 롤백도 실패!\n원인: ${e.message}\n롤백 오류: ${rollbackErr.message}\n\n관리자에게 문의하세요.`);
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h3 className="text-white font-bold mb-3">은행 입금내역 업로드</h3>

        {!excelData ? (
          parsing ? (
            <div className="flex items-center justify-center bg-slate-700 text-white rounded-lg px-4 py-8 border-2 border-dashed border-slate-600">
              <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-indigo-400 mr-3"></div>
              <span>엑셀 파일 분석 중...</span>
            </div>
          ) : (
            <label className="flex items-center justify-center bg-slate-700 hover:bg-slate-600 transition-colors text-white rounded-lg px-4 py-8 cursor-pointer border-2 border-dashed border-slate-600">
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
              <span>📁 엑셀 파일 선택 (입금내역)</span>
            </label>
          )
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
              {parsed.some(p => p.isDuplicate) && (
                <span className="text-orange-400 ml-2">· 중복 {parsed.filter(p => p.isDuplicate).length} (자동 스킵)</span>
              )}
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
                      {p.status === 'duplicate' ? <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded">중복</span> :
                       p.status === 'matched' ? <span className="bg-green-500/20 text-green-300 px-2 py-0.5 rounded">일치</span> :
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
