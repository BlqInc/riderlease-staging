import React, { useState, useMemo, memo } from 'react';
import { Contract, Partner, ContractStatus, Salesperson, CreditorSettlementRound } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { computePaymentStats, classifyRisk, riskColors, RiskLevel } from '../lib/riskUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { BankDepositUpload } from './BankDepositUpload';
import { BankDepositHistory } from './BankDepositHistory';
import { CollectionDashboard } from './CollectionDashboard';
import { ExpiredCollectionActions } from './ExpiredCollectionActions';
import { AutomationCenter } from './AutomationCenter';
import { InfoTooltip } from './InfoTooltip';
import { usePersistedState } from '../lib/usePersistedState';
import { supabase } from '../lib/supabaseClient';
import { SettlementRequestModal } from './SettlementRequestModal';

interface CollectionManagementProps {
  contracts: Contract[];
  partners: Partner[];
  salespeople?: Salesperson[];
  settlements?: CreditorSettlementRound[];
  onDepositsProcessed?: () => void;
  onSelectContract?: (contract: Contract) => void;
}

// 상수 (컴포넌트 외부 - 매 렌더마다 재생성 방지)
const RISK_TABS: (RiskLevel | '전체')[] = ['전체', '정상', '주의', '위험', '소송중'];
const CHART_MARGIN = { top: 5, right: 20, left: 10, bottom: 40 } as const;
const CHART_TOOLTIP_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' } as const;
const CHART_XAXIS_TICK = { fill: '#94a3b8', fontSize: 12 } as const;
const CHART_YAXIS_TICK = { fill: '#94a3b8', fontSize: 12 } as const;
const CHART_YAXIS_DOMAIN: [number, number] = [0, 100];
const CHART_BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

const StatCard: React.FC<{ title: string; value: string | number; description: string; colorClass?: string; tooltip?: string }> = ({ title, value, description, colorClass = "bg-slate-800", tooltip }) => (
  <div className={`${colorClass} p-6 rounded-lg shadow-lg border border-slate-700`}>
    <h3 className="text-sm font-medium text-slate-400 flex items-center gap-1">
      {title}
      {tooltip && <InfoTooltip text={tooltip} />}
    </h3>
    <p className="text-3xl font-bold text-white mt-2">{value}</p>
    <p className="text-xs text-slate-500 mt-1">{description}</p>
  </div>
);

const RiskBadge: React.FC<{ level: RiskLevel }> = ({ level }) => (
  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${riskColors[level]}`}>{level}</span>
);

type SortKey = 'paymentRate' | 'overdueDays' | 'balance' | 'expectedByToday';

// 행 컴포넌트 메모이제이션 — 계약이 변경되지 않았다면 재렌더 방지
interface CollectionRowProps {
  row: {
    contract: Contract;
    expectedByToday: number;
    totalPaid: number;
    balance: number;
    paymentRate: number;
    lastPaymentDate: string | null;
    overdueDays: number;
    risk: RiskLevel;
  };
  selected: boolean;
  onToggle: (id: string) => void;
  onSelectContract?: (contract: Contract) => void;
  publishMode: boolean;
}
const CollectionRow = memo<CollectionRowProps>(({ row, selected, onToggle, onSelectContract, publishMode }) => (
  <tr className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
    {publishMode && (
      <td className="p-3 text-center">
        <input type="checkbox" checked={selected} onChange={() => onToggle(row.contract.id)}
          className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-700 text-indigo-600" />
      </td>
    )}
    <td className="p-3 font-mono text-xs">
      {onSelectContract ? (
        <button onClick={() => onSelectContract(row.contract)}
          className="text-indigo-300 hover:text-indigo-200 hover:underline">
          {row.contract.contract_number ?? '-'}
        </button>
      ) : (
        <span className="text-slate-300">{row.contract.contract_number ?? '-'}</span>
      )}
    </td>
    <td className="p-3 text-white">{row.contract.lessee_name || '-'}</td>
    <td className="p-3 text-slate-300">{row.contract.distributor_name || '-'}</td>
    <td className="p-3 text-right text-slate-300">{formatCurrency(row.expectedByToday)}</td>
    <td className="p-3 text-right text-green-400">{formatCurrency(row.totalPaid)}</td>
    <td className="p-3 text-right text-red-400">{formatCurrency(row.balance)}</td>
    <td className="p-3 text-right">
      <span className={row.paymentRate >= 80 ? 'text-green-400' : row.paymentRate >= 50 ? 'text-yellow-400' : 'text-red-400'}>
        {row.paymentRate.toFixed(1)}%
      </span>
    </td>
    <td className="p-3 text-center text-slate-400">{row.lastPaymentDate ? formatDate(row.lastPaymentDate) : '-'}</td>
    <td className="p-3 text-right">
      {row.overdueDays > 0 ? <span className="text-red-400 font-semibold">{row.overdueDays}일</span> : <span className="text-slate-500">-</span>}
    </td>
    <td className="p-3 text-center"><RiskBadge level={row.risk} /></td>
  </tr>
));

// 이번 달 1일~오늘 기본값
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

function formatRangeLabel(from: string, to: string): string {
  const f = from.split('-');
  const t = to.split('-');
  if (f.length === 3 && t.length === 3) {
    return `${Number(f[1])}/${Number(f[2])}~${Number(t[1])}/${Number(t[2])})`;
  }
  return `${from}~${to})`;
}

export const CollectionManagement: React.FC<CollectionManagementProps> = ({ contracts, partners, salespeople = [], settlements = [], onDepositsProcessed, onSelectContract }) => {
  const [showUpload, setShowUpload] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showExcelModal, setShowExcelModal] = useState(false);
  const [excelRange, setExcelRange] = useState(defaultRange);
  const [excelLoading, setExcelLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [publishMode, setPublishMode] = useState(false);
  const [showRawModal, setShowRawModal] = useState(false);
  const [rawRange, setRawRange] = useState(defaultRange);
  const [rawLoading, setRawLoading] = useState(false);

  const exitPublishMode = React.useCallback(() => {
    setPublishMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = React.useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const safeContracts = Array.isArray(contracts) ? contracts : [];
  // 페이지 이동 후에도 필터 유지 (localStorage)
  const [riskFilter, setRiskFilter] = usePersistedState<RiskLevel | '전체'>('cm:risk-filter', '전체');
  const [keyword, setKeyword] = usePersistedState<string>('cm:keyword', '');
  const [sortKey, setSortKey] = usePersistedState<SortKey>('cm:sort-key', 'paymentRate');
  const [sortAsc, setSortAsc] = usePersistedState<boolean>('cm:sort-asc', true);
  // 계약별 상세 목록은 매 진입 시 닫힌 채로 시작 (열면 1000+ 행 테이블이 첫 페인트를 차단)
  const [showContractList, setShowContractList] = useState<boolean>(false);
  const [showAutomation, setShowAutomation] = usePersistedState<boolean>('cm:show-automation', false);

  // Compute per-contract stats
  const contractStats = useMemo(() => {
    return safeContracts.map(c => {
      const stats = computePaymentStats(c);
      const risk = classifyRisk(stats.overdueDays, c.is_lawsuit);
      return { contract: c, ...stats, risk };
    });
  }, [safeContracts]);

  // 위험등급 필터 (contractStats + riskFilter)
  const riskFilteredStats = useMemo(() => {
    if (riskFilter === '전체') return contractStats;
    return contractStats.filter(c => c.risk === riskFilter);
  }, [contractStats, riskFilter]);

  // 키워드 필터 (riskFilteredStats + keyword)
  const keywordFilteredStats = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return riskFilteredStats;
    return riskFilteredStats.filter(c =>
      (c.contract.lessee_name || '').toLowerCase().includes(kw) ||
      (c.contract.distributor_name || '').toLowerCase().includes(kw) ||
      String(c.contract.contract_number).includes(kw)
    );
  }, [riskFilteredStats, keyword]);

  // 정렬 (keywordFilteredStats + sortKey + sortAsc) - 새 배열 복사 후 정렬
  const filtered = useMemo(() => {
    const result = keywordFilteredStats.slice();
    result.sort((a, b) => {
      const av = a[sortKey] as number; const bv = b[sortKey] as number;
      return sortAsc ? av - bv : bv - av;
    });
    return result;
  }, [keywordFilteredStats, sortKey, sortAsc]);

  // Per-distributor chart
  const distributorChart = useMemo(() => {
    const map = new Map<string, { paid: number; expected: number }>();
    contractStats.forEach(c => {
      const name = c.contract.distributor_name || '미지정';
      const prev = map.get(name) || { paid: 0, expected: 0 };
      map.set(name, { paid: prev.paid + c.totalPaid, expected: prev.expected + c.expectedByToday });
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name: name.length > 6 ? name.slice(0, 6) + '..' : name,
        납부율: v.expected > 0 ? Math.round((v.paid / v.expected) * 100) : 0,
      }))
      .sort((a, b) => a.납부율 - b.납부율)
      .slice(0, 20);
  }, [contractStats]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  // ─── 엑셀 다운로드: 기간 × 계약 일별 풀림 ───
  const handleExcelDownload = async () => {
    if (excelLoading) return;
    const { from, to } = excelRange;
    if (!from || !to || from > to) { alert('기간을 올바르게 입력하세요.'); return; }
    setExcelLoading(true);
    try {
      // 그 기간 내 bank_deposits 조회 (salesperson_id, depositor_name 매핑용)
      const { data: deposits } = await (supabase.from('bank_deposits') as any)
        .select('deposit_date, depositor_name, salesperson_id')
        .gte('deposit_date', from)
        .lte('deposit_date', to)
        .is('reverted_at', null);

      // (date|salesperson_id) → Set<depositor_name>
      const depositorIndex = new Map<string, Set<string>>();
      (deposits || []).forEach((d: any) => {
        if (!d.salesperson_id || !d.deposit_date) return;
        const key = `${d.deposit_date}|${d.salesperson_id}`;
        const set = depositorIndex.get(key) || new Set<string>();
        set.add(d.depositor_name || '');
        depositorIndex.set(key, set);
      });

      // 계약 → 담당 영업자 매핑 (partner_id 기준)
      const partnerToSalesperson = new Map<string, string>();
      salespeople.forEach(s => (s.partner_ids || []).forEach(pid => partnerToSalesperson.set(pid, s.id)));

      // 기간 내 날짜 배열
      const dates: string[] = [];
      const fromDate = new Date(from);
      const toDate = new Date(to);
      for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dates.push(`${y}-${m}-${day}`);
      }

      // 행 생성: 현재 필터링된 계약 × 각 날짜 (해당 일자 daily_deduction 존재 시)
      const dataRows: (string | number)[][] = [];
      for (const date of dates) {
        for (const row of filtered) {
          const c = row.contract;
          const dd = (c.daily_deductions || []).find(x => x.date === date);
          if (!dd) continue;
          const spId = c.partner_id ? partnerToSalesperson.get(c.partner_id) : undefined;
          const names = spId ? Array.from(depositorIndex.get(`${date}|${spId}`) || []).filter(Boolean).join(', ') : '';
          dataRows.push([
            date,
            c.contract_number ?? '',
            c.lessee_name || '',
            c.distributor_name || '',
            names,
            Number(dd.paid_amount) || 0,
          ]);
        }
      }

      // 엑셀 빌드
      const XLSX = await import('xlsx-js-style');
      const headerRow = [formatRangeLabel(from, to), '조회일자의 기준은 입금일자를 의미'];
      const columnHeaders = ['일자', '계약번호', '계약자', '총판', '입금자명', '입금액'];
      const aoa: any[][] = [headerRow, columnHeaders, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // 헤더 스타일 (행 1 = 컬럼 헤더)
      const headerStyle = {
        fill: { fgColor: { rgb: '4472C4' } },
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      };
      for (let c = 0; c < columnHeaders.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 1, c });
        if (ws[addr]) ws[addr].s = headerStyle;
      }
      // 입금액 컬럼 천단위 콤마
      for (let r = 2; r < aoa.length; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: 5 });
        if (ws[addr]) ws[addr].z = '#,##0';
      }
      // 컬럼 너비
      ws['!cols'] = [
        { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 12 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '회수내역');
      const fname = `회수관리_${from.replace(/-/g,'')}-${to.replace(/-/g,'')}_${riskFilter}.xlsx`;
      XLSX.writeFile(wb, fname);
      setShowExcelModal(false);
    } catch (e) {
      console.error(e);
      alert('엑셀 생성 실패: ' + (e as Error).message);
    } finally {
      setExcelLoading(false);
    }
  };

  // ─── 입금 raw data 다운로드 ───
  // 데이터 소스: contracts.daily_deductions.paid_amount (모든 입금 처리 경로 자동 포함)
  // 출처 추적: bank_deposits + bulk_payment_allocations(+batches)
  // 컬럼: 일자|계약번호|계약자|총판|영업자|입금자/출처|입금액
  const handleRawDownload = async () => {
    if (rawLoading) return;
    const { from, to } = rawRange;
    if (!from || !to || from > to) { alert('기간을 올바르게 입력하세요.'); return; }
    setRawLoading(true);
    try {
      // 1) bank_deposits — depositor_name 추적 (영업자 매칭된 것 + 수동처리 모두)
      const { data: deposits } = await (supabase.from('bank_deposits') as any)
        .select('deposit_date, depositor_name, salesperson_id')
        .gte('deposit_date', from).lte('deposit_date', to)
        .is('reverted_at', null);

      const depositorBySpDate = new Map<string, Set<string>>();    // 영업자 매칭된 경우
      const manualByDate = new Map<string, Set<string>>();         // 수동처리(salesperson_id null) — depositor_name에 계약자명 포함
      (deposits || []).forEach((d: any) => {
        const name = d.depositor_name || '';
        if (!name) return;
        if (d.salesperson_id) {
          const key = `${d.salesperson_id}|${d.deposit_date}`;
          const set = depositorBySpDate.get(key) || new Set<string>();
          set.add(name);
          depositorBySpDate.set(key, set);
        } else {
          const set = manualByDate.get(d.deposit_date) || new Set<string>();
          set.add(name);
          manualByDate.set(d.deposit_date, set);
        }
      });

      // 2) bulk_payment_allocations + batches — 일괄납부 추적
      const { data: allocs } = await (supabase.from('bulk_payment_allocations') as any)
        .select('batch_id, contract_id, due_date')
        .gte('due_date', from).lte('due_date', to);
      let batchPartnerNames = new Map<string, string[]>();
      if ((allocs || []).length > 0) {
        const batchIds = Array.from(new Set((allocs || []).map((a: any) => a.batch_id)));
        const { data: batches } = await (supabase.from('bulk_payment_batches') as any)
          .select('id, partner_names').in('id', batchIds).eq('status', 'completed');
        (batches || []).forEach((b: any) => batchPartnerNames.set(b.id, b.partner_names || []));
      }
      // (contract_id, due_date) → bulk 출처 partner 이름 리스트
      const bulkByKey = new Map<string, Set<string>>();
      (allocs || []).forEach((a: any) => {
        const partners = batchPartnerNames.get(a.batch_id);
        if (!partners) return;
        const key = `${a.contract_id}|${a.due_date}`;
        const set = bulkByKey.get(key) || new Set<string>();
        partners.forEach(p => set.add(p));
        bulkByKey.set(key, set);
      });

      // 3) 영업자 매핑
      const partnerToSp = new Map<string, string>();
      const spById = new Map<string, any>();
      salespeople.forEach(s => {
        spById.set(s.id, s);
        (s.partner_ids || []).forEach(pid => partnerToSp.set(pid, s.id));
      });

      // 4) 영업자별 contracts 그룹핑
      const bySalesperson = new Map<string, Contract[]>();
      const orphanContracts: Contract[] = [];
      for (const c of safeContracts) {
        const spId = c.partner_id ? partnerToSp.get(c.partner_id) : undefined;
        if (spId) {
          const arr = bySalesperson.get(spId) || [];
          arr.push(c);
          bySalesperson.set(spId, arr);
        } else {
          orphanContracts.push(c);
        }
      }

      const buildSourceLabel = (spId: string | null, contractId: string, lessee: string, date: string): string => {
        const parts: string[] = [];
        if (spId) {
          const set = depositorBySpDate.get(`${spId}|${date}`);
          set?.forEach(n => parts.push(n));
        }
        // 일괄납부 출처
        const bulkSet = bulkByKey.get(`${contractId}|${date}`);
        bulkSet?.forEach(p => parts.push(`${p} (일괄)`));
        // 수동처리: depositor_name에 계약자명 포함된 경우 매칭
        if (lessee) {
          const set = manualByDate.get(date);
          set?.forEach(n => { if (n.includes(lessee)) parts.push(n); });
        }
        return Array.from(new Set(parts)).join(', ');
      };

      const dataRows: (string | number)[][] = [];

      // 5) 영업자 그룹별: 활동 일자(paid_amount>0인 일자) × 담당 모든 계약 펼침 (미납 0 포함)
      for (const [spId, contractsOfSp] of bySalesperson.entries()) {
        const spName = spById.get(spId)?.name || '';
        const activeDates = new Set<string>();
        for (const c of contractsOfSp) {
          for (const dd of (c.daily_deductions || [])) {
            if (!dd.date || dd.date < from || dd.date > to) continue;
            if ((Number(dd.paid_amount) || 0) > 0) activeDates.add(dd.date);
          }
        }
        for (const date of activeDates) {
          for (const c of contractsOfSp) {
            const dd = (c.daily_deductions || []).find(x => x.date === date);
            if (!dd) continue;
            dataRows.push([
              date,
              c.contract_number ?? '',
              c.lessee_name || '',
              c.distributor_name || '',
              spName,
              buildSourceLabel(spId, c.id, c.lessee_name || '', date),
              Number(dd.paid_amount) || 0,
            ]);
          }
        }
      }

      // 6) 영업자 없는 계약: 자기 자신 paid_amount>0 일자만
      for (const c of orphanContracts) {
        for (const dd of (c.daily_deductions || [])) {
          if (!dd.date || dd.date < from || dd.date > to) continue;
          const paid = Number(dd.paid_amount) || 0;
          if (paid <= 0) continue;
          dataRows.push([
            dd.date,
            c.contract_number ?? '',
            c.lessee_name || '',
            c.distributor_name || '',
            '',
            buildSourceLabel(null, c.id, c.lessee_name || '', dd.date),
            paid,
          ]);
        }
      }

      dataRows.sort((a, b) => {
        const da = String(a[0]), db = String(b[0]);
        if (da !== db) return da < db ? -1 : 1;
        return (Number(a[1]) || 0) - (Number(b[1]) || 0);
      });

      if (dataRows.length === 0) {
        alert(
          '기간 내 입금 처리된 내역이 없습니다.\n' +
          `· 영업자 그룹: ${bySalesperson.size}명\n` +
          `· 영업자 없는 계약: ${orphanContracts.length}건\n` +
          `· bank_deposits: ${deposits?.length || 0}건\n` +
          `· bulk_payment_allocations: ${(allocs || []).length}건`
        );
        return;
      }

      // 엑셀 빌드
      const XLSX = await import('xlsx-js-style');
      const headerRow = [formatRangeLabel(from, to), '입금 처리 raw data — 모든 경로 통합 (통장업로드/일괄납부/수동처리)'];
      const columnHeaders = ['일자', '계약번호', '계약자', '총판', '영업자', '입금자/출처', '입금액'];
      const aoa: any[][] = [headerRow, columnHeaders, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      const headerStyle = {
        fill: { fgColor: { rgb: '4472C4' } },
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} },
      };
      for (let c = 0; c < columnHeaders.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: 1, c });
        if (ws[addr]) ws[addr].s = headerStyle;
      }
      // 입금액(컬럼 6) 천단위 콤마
      for (let r = 2; r < aoa.length; r++) {
        const addr = XLSX.utils.encode_cell({ r, c: 6 });
        if (ws[addr]) ws[addr].z = '#,##0';
      }
      ws['!cols'] = [
        { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 30 }, { wch: 14 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '회수 raw data');
      XLSX.writeFile(wb, `회수_raw_${from.replace(/-/g,'')}-${to.replace(/-/g,'')}.xlsx`);
      setShowRawModal(false);
    } catch (e: any) {
      console.error(e);
      alert('다운로드 실패: ' + (e.message || e));
    } finally {
      setRawLoading(false);
    }
  };

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  const riskCounts = useMemo(() => {
    const counts: Record<string, number> = { '전체': contractStats.length };
    for (let i = 0; i < contractStats.length; i++) {
      const r = contractStats[i].risk;
      counts[r] = (counts[r] || 0) + 1;
    }
    return counts;
  }, [contractStats]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-white">회수 관리</h2>
        {onDepositsProcessed && (
          <div className="flex gap-2">
            <button onClick={() => setShowRawModal(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg">
              📥 입금 raw data
            </button>
            <button onClick={() => { setShowHistory(!showHistory); setShowUpload(false); }}
              className="bg-slate-700 hover:bg-slate-600 text-white font-bold px-4 py-2 rounded-lg">
              {showHistory ? '닫기' : '📋 입금 이력'}
            </button>
            <button onClick={() => { setShowUpload(!showUpload); setShowHistory(false); }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg">
              {showUpload ? '닫기' : '🏦 은행 입금내역 업로드'}
            </button>
          </div>
        )}
      </div>

      {/* 입금 raw data 다운로드 모달 */}
      {showRawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !rawLoading && setShowRawModal(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[460px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-semibold mb-1">입금 raw data 다운로드</h3>
            <p className="text-xs text-slate-400 mb-4">
              영업자가 입금한 날 기준으로, 그 영업자가 관리하는 모든 계약 행을 펼침. 입금액 0 = 미납.
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 w-12">시작일</label>
                <input type="date" value={rawRange.from}
                  onChange={e => setRawRange(r => ({ ...r, from: e.target.value }))}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 w-12">종료일</label>
                <input type="date" value={rawRange.to}
                  onChange={e => setRawRange(r => ({ ...r, to: e.target.value }))}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white flex-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowRawModal(false)} disabled={rawLoading}
                className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50">
                취소
              </button>
              <button onClick={handleRawDownload} disabled={rawLoading}
                className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                {rawLoading ? '생성 중...' : '다운로드'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpload && onDepositsProcessed && (
        <BankDepositUpload
          contracts={contracts}
          partners={partners}
          salespeople={salespeople}
          settlements={settlements}
          onProcessed={() => { setShowUpload(false); onDepositsProcessed(); }}
        />
      )}

      {showHistory && onDepositsProcessed && (
        <BankDepositHistory salespeople={salespeople} onReverted={onDepositsProcessed} />
      )}

      {/* 업로드/이력 모드일 때는 아래 테이블/차트 숨김 (성능 최적화) */}
      {!showUpload && !showHistory && (
        <>
      {/* 📊 회수 대시보드 (기간별 KPI + 일별 차트 + 위험 총판) */}
      <CollectionDashboard />

      {/* 🔔 자동 조치 센터 (SMS/신정사 메일 큐) — 토글: 펼칠 때만 RPC 조회 */}
      <div className="border-t border-slate-700 pt-4">
        <button onClick={() => setShowAutomation(s => !s)}
          className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors">
          <span>{showAutomation ? '▼' : '▶'}</span>
          <span className="font-medium">🔔 자동 조치 센터</span>
          <span className="text-xs text-slate-500">(SMS 발송 대기 · 신정사 메일 대상 · 발송 이력)</span>
        </button>
      </div>
      {showAutomation && <AutomationCenter />}

      {/* 🚨 미수 계약 회수 관리 (조치 체크리스트) */}
      <ExpiredCollectionActions />

      {/* 계약별 상세 목록 토글 */}
      <div className="border-t border-slate-700 pt-4">
        <button onClick={() => setShowContractList(s => !s)}
          className="flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors">
          <span>{showContractList ? '▼' : '▶'}</span>
          <span className="font-medium">계약별 상세 목록</span>
          <span className="text-xs text-slate-500">(계약자/위험등급별 납부 현황 · 총판별 납부율)</span>
        </button>
      </div>

      {showContractList && <>
      {/* Filter & Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-slate-800 rounded-lg p-1 gap-1">
          {RISK_TABS.map(tab => {
            const tip = tab === '전체' ? '모든 위험등급 포함'
              : tab === '정상' ? '연체 0~7일인 계약'
              : tab === '주의' ? '연체 8~14일인 계약'
              : tab === '위험' ? '연체 15일 이상인 계약'
              : '소송 진행 중으로 표시된 계약';
            return (
              <InfoTooltip key={tab} text={tip} placement="bottom">
                <button onClick={() => setRiskFilter(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    riskFilter === tab ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}>
                  {tab} ({riskCounts[tab] || 0})
                </button>
              </InfoTooltip>
            );
          })}
        </div>
        <input type="text" placeholder="계약자명, 총판명, 계약번호 검색..."
          value={keyword} onChange={e => setKeyword(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 flex-1 max-w-xs" />
        <button onClick={() => setShowExcelModal(true)}
          className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
          📥 엑셀 다운로드
        </button>
        <button onClick={() => publishMode ? exitPublishMode() : setPublishMode(true)}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
            publishMode
              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
          }`}>
          📋 {publishMode ? '발행 모드 종료' : '정산요청서 발행 모드'}
        </button>
      </div>

      {/* 엑셀 다운로드 모달 */}
      {showExcelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !excelLoading && setShowExcelModal(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[420px] max-w-[90vw]" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-semibold mb-1">회수 내역 엑셀 다운로드</h3>
            <p className="text-xs text-slate-400 mb-4">
              현재 필터 (<span className="text-slate-200">{riskFilter}</span>{keyword ? ` / "${keyword}"` : ''}) 기준 · 기간 내 일별 차감 풀림
            </p>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 w-12">시작일</label>
                <input type="date" value={excelRange.from}
                  onChange={e => setExcelRange(r => ({ ...r, from: e.target.value }))}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 w-12">종료일</label>
                <input type="date" value={excelRange.to}
                  onChange={e => setExcelRange(r => ({ ...r, to: e.target.value }))}
                  className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white flex-1" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowExcelModal(false)} disabled={excelLoading}
                className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50">
                취소
              </button>
              <button onClick={handleExcelDownload} disabled={excelLoading}
                className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                {excelLoading ? '생성 중...' : '다운로드'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-800 rounded-lg shadow-lg border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              {publishMode && (
                <th className="p-3 w-10 text-center">
                  <input type="checkbox"
                    checked={filtered.length > 0 && filtered.every(r => selectedIds.has(r.contract.id))}
                    onChange={() => {
                      const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.contract.id));
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (allSelected) filtered.forEach(r => next.delete(r.contract.id));
                        else filtered.forEach(r => next.add(r.contract.id));
                        return next;
                      });
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-700 text-indigo-600" />
                </th>
              )}
              <th className="text-left p-3 font-medium">계약번호</th>
              <th className="text-left p-3 font-medium">계약자</th>
              <th className="text-left p-3 font-medium">총판</th>
              <th className="text-right p-3 font-medium cursor-pointer hover:text-white" onClick={() => handleSort('expectedByToday')}>
                오늘까지 내야할 금액{sortIndicator('expectedByToday')}
              </th>
              <th className="text-right p-3 font-medium">납부액</th>
              <th className="text-right p-3 font-medium cursor-pointer hover:text-white" onClick={() => handleSort('balance')}>
                미납액{sortIndicator('balance')}
              </th>
              <th className="text-right p-3 font-medium cursor-pointer hover:text-white" onClick={() => handleSort('paymentRate')}>
                납부율{sortIndicator('paymentRate')}
              </th>
              <th className="text-center p-3 font-medium">최근 납부일</th>
              <th className="text-right p-3 font-medium cursor-pointer hover:text-white" onClick={() => handleSort('overdueDays')}>
                연체일{sortIndicator('overdueDays')}
              </th>
              <th className="text-center p-3 font-medium">위험등급</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={publishMode ? 11 : 10} className="text-center text-slate-500 py-8">해당하는 계약이 없습니다</td></tr>
            ) : filtered.map(row => (
              <CollectionRow key={row.contract.id} row={row}
                selected={publishMode ? selectedIds.has(row.contract.id) : false}
                onToggle={toggleSelect}
                onSelectContract={onSelectContract}
                publishMode={publishMode} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Distributor Chart */}
      {distributorChart.length > 0 && (
        <div className="bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-4">총판별 납부율</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={distributorChart} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={CHART_XAXIS_TICK} angle={-35} textAnchor="end" />
              <YAxis tick={CHART_YAXIS_TICK} domain={CHART_YAXIS_DOMAIN} unit="%" />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value: number) => [`${value}%`, '납부율']} />
              <Bar dataKey="납부율" radius={CHART_BAR_RADIUS} maxBarSize={50}>
                {distributorChart.map((entry, idx) => (
                  <Cell key={idx} fill={entry.납부율 >= 80 ? '#22c55e' : entry.납부율 >= 50 ? '#eab308' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      </>}
        </>
      )}

      {/* 정산요청서 발행 — 플로팅 바 (발행 모드 + 선택 1건 이상) */}
      {publishMode && selectedIds.size > 0 && !showSettleModal && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-800 border border-indigo-500 rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm text-white">
            <span className="text-indigo-400 font-semibold">{selectedIds.size}건</span> 선택됨
          </span>
          <button onClick={() => setSelectedIds(new Set())}
            className="text-xs text-slate-400 hover:text-white">선택 해제</button>
          <button onClick={() => setShowSettleModal(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
            📋 정산요청서 발행
          </button>
        </div>
      )}

      <SettlementRequestModal
        open={showSettleModal}
        contracts={safeContracts.filter(c => selectedIds.has(c.id))}
        onClose={() => setShowSettleModal(false)}
        onPublished={() => { setSelectedIds(new Set()); onDepositsProcessed?.(); }}
      />
    </div>
  );
};
