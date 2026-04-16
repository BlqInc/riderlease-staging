import React, { useState, useMemo, memo } from 'react';
import { Contract, Partner, ContractStatus } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { computePaymentStats, classifyRisk, riskColors, RiskLevel } from '../lib/riskUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface CollectionManagementProps {
  contracts: Contract[];
  partners: Partner[];
  onBulkDistributorPayment?: (distributorName: string, dateFrom: string, dateTo: string, inputAmount: number, excludeContractIds: string[]) => Promise<{ processed: number; remaining: number } | undefined>;
}

// 상수 (컴포넌트 외부 - 매 렌더마다 재생성 방지)
const RISK_TABS: (RiskLevel | '전체')[] = ['전체', '정상', '주의', '위험', '소송중'];
const CHART_MARGIN = { top: 5, right: 20, left: 10, bottom: 40 } as const;
const CHART_TOOLTIP_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' } as const;
const CHART_XAXIS_TICK = { fill: '#94a3b8', fontSize: 12 } as const;
const CHART_YAXIS_TICK = { fill: '#94a3b8', fontSize: 12 } as const;
const CHART_YAXIS_DOMAIN: [number, number] = [0, 100];
const CHART_BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

const StatCard: React.FC<{ title: string; value: string | number; description: string; colorClass?: string }> = ({ title, value, description, colorClass = "bg-slate-800" }) => (
  <div className={`${colorClass} p-6 rounded-lg shadow-lg border border-slate-700`}>
    <h3 className="text-sm font-medium text-slate-400">{title}</h3>
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
}
const CollectionRow = memo<CollectionRowProps>(({ row }) => (
  <tr className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
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

export const CollectionManagement: React.FC<CollectionManagementProps> = ({ contracts, partners, onBulkDistributorPayment }) => {
  const safeContracts = Array.isArray(contracts) ? contracts : [];
  const [riskFilter, setRiskFilter] = useState<RiskLevel | '전체'>('전체');
  const [keyword, setKeyword] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('paymentRate');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // 총판별 일괄 납부 모달
  const [bulkPayModal, setBulkPayModal] = useState<{ distributor: string } | null>(null);
  const [bulkPayForm, setBulkPayForm] = useState({ dateFrom: '', dateTo: '', amount: '' });
  const [bulkPayExclude, setBulkPayExclude] = useState<Set<string>>(new Set());
  const [bulkPayProcessing, setBulkPayProcessing] = useState(false);
  const [bulkPayResult, setBulkPayResult] = useState<{ processed: number; remaining: number } | null>(null);

  // Compute per-contract stats
  const contractStats = useMemo(() => {
    return safeContracts.map(c => {
      const stats = computePaymentStats(c);
      const risk = classifyRisk(stats.overdueDays, c.is_lawsuit);
      return { contract: c, ...stats, risk };
    });
  }, [safeContracts]);

  // Summary - 단일 패스로 reduce 결합
  const summary = useMemo(() => {
    let totalExpected = 0;
    let totalPaidSum = 0;
    let overdueContracts = 0;
    for (let i = 0; i < contractStats.length; i++) {
      const c = contractStats[i];
      totalExpected += c.expectedByToday;
      totalPaidSum += c.totalPaid;
      if (c.contract.status === ContractStatus.ACTIVE && c.overdueCount > 0) overdueContracts++;
    }
    const overallRate = totalExpected > 0 ? (totalPaidSum / totalExpected) * 100 : 0;

    // 이번 달 회수 예정액 - today/remainingDays는 한 번만 계산
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const today = now.getDate();
    const remainingDays = lastDay - today;
    let monthlyExpected = 0;
    for (let i = 0; i < safeContracts.length; i++) {
      const c = safeContracts[i];
      if (c.status === ContractStatus.ACTIVE) {
        monthlyExpected += (Number(c.daily_deduction) || 0) * remainingDays;
      }
    }

    return { overallRate, overdueContracts, monthlyExpected };
  }, [contractStats, safeContracts]);

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
      <h2 className="text-3xl font-bold text-white">회수 관리</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="전체 납부율"
          value={`${summary.overallRate.toFixed(1)}%`}
          description="납부액 / 오늘까지 내야할 금액"
        />
        <StatCard
          title="연체 건수"
          value={`${summary.overdueContracts}건`}
          description="미납 차감이 있는 진행중 계약"
          colorClass={summary.overdueContracts > 0 ? 'bg-red-900/30 border-red-500/30' : 'bg-slate-800'}
        />
        <StatCard
          title="이번 달 회수 예정액"
          value={formatCurrency(summary.monthlyExpected)}
          description="남은 일수 × 일차감액 합계"
        />
      </div>

      {/* Filter & Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-slate-800 rounded-lg p-1 gap-1">
          {RISK_TABS.map(tab => (
            <button key={tab} onClick={() => setRiskFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                riskFilter === tab ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}>
              {tab} ({riskCounts[tab] || 0})
            </button>
          ))}
        </div>
        <input type="text" placeholder="계약자명, 총판명, 계약번호 검색..."
          value={keyword} onChange={e => setKeyword(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 flex-1 max-w-xs" />
        {onBulkDistributorPayment && (
          <button
            onClick={() => {
              const name = prompt('총판명을 입력하세요:');
              if (name?.trim()) {
                setBulkPayModal({ distributor: name.trim() });
                setBulkPayForm({ dateFrom: '', dateTo: '', amount: '' });
                setBulkPayExclude(new Set());
                setBulkPayResult(null);
              }
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            총판 일괄 납부
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-lg shadow-lg border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
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
              <tr><td colSpan={9} className="text-center text-slate-500 py-8">해당하는 계약이 없습니다</td></tr>
            ) : filtered.map(row => (
              <CollectionRow key={row.contract.id} row={row} />
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
      {/* 총판 일괄 납부 모달 */}
      {bulkPayModal && onBulkDistributorPayment && (() => {
        const distContracts = safeContracts.filter(c => c.distributor_name === bulkPayModal.distributor);
        const expectedTotal = distContracts
          .filter(c => !bulkPayExclude.has(c.id))
          .reduce((sum, c) => {
            if (!bulkPayForm.dateFrom || !bulkPayForm.dateTo) return sum;
            const days = (c.daily_deductions || []).filter(d =>
              d.date >= bulkPayForm.dateFrom && d.date <= bulkPayForm.dateTo && d.status !== '납부완료'
            ).reduce((s, d) => s + (d.amount - d.paid_amount), 0);
            // daily_deductions가 없으면 daily_deduction × 일수로 추정
            if (!c.daily_deductions || c.daily_deductions.length === 0) {
              const from = new Date(bulkPayForm.dateFrom);
              const to = new Date(bulkPayForm.dateTo);
              const numDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
              return sum + (c.daily_deduction || 0) * numDays;
            }
            return sum + days;
          }, 0);
        const inputAmt = Number(bulkPayForm.amount) || 0;
        const diff = inputAmt - expectedTotal;

        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-700">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-white">총판 일괄 납부</h2>
                    <p className="text-slate-400 text-sm mt-1">{bulkPayModal.distributor} · {distContracts.length}건</p>
                  </div>
                  <button onClick={() => setBulkPayModal(null)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* 기간 + 금액 */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">정산 시작일</label>
                    <input type="date" value={bulkPayForm.dateFrom}
                      onChange={e => setBulkPayForm(p => ({ ...p, dateFrom: e.target.value }))}
                      className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">정산 종료일</label>
                    <input type="date" value={bulkPayForm.dateTo}
                      onChange={e => setBulkPayForm(p => ({ ...p, dateTo: e.target.value }))}
                      className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">입금액</label>
                    <input type="number" value={bulkPayForm.amount} placeholder="0"
                      onChange={e => setBulkPayForm(p => ({ ...p, amount: e.target.value }))}
                      className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>

                {/* 예상 vs 입금 비교 */}
                {bulkPayForm.dateFrom && bulkPayForm.dateTo && (
                  <div className="grid grid-cols-3 gap-3 bg-slate-900/50 rounded-lg p-4">
                    <div>
                      <p className="text-xs text-slate-400">예상 청구액</p>
                      <p className="text-lg font-bold text-white">{formatCurrency(expectedTotal)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">입금액</p>
                      <p className="text-lg font-bold text-white">{formatCurrency(inputAmt)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">차액</p>
                      <p className={`text-lg font-bold ${diff === 0 ? 'text-green-400' : diff > 0 ? 'text-blue-400' : 'text-red-400'}`}>
                        {diff === 0 ? '일치' : formatCurrency(diff)}
                      </p>
                    </div>
                  </div>
                )}

                {/* 계약 목록 (체크 해제로 제외 가능) */}
                <div>
                  <p className="text-sm font-semibold text-slate-300 mb-2">포함 계약 ({distContracts.length - bulkPayExclude.size}건)</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {distContracts.map(c => (
                      <label key={c.id} className={`flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700/50 cursor-pointer ${bulkPayExclude.has(c.id) ? 'opacity-40' : ''}`}>
                        <input type="checkbox" checked={!bulkPayExclude.has(c.id)}
                          onChange={() => setBulkPayExclude(prev => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                            return next;
                          })}
                          className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600" />
                        <span className="text-sm text-white flex-1">{c.lessee_name || '미지정'}</span>
                        <span className="text-xs text-slate-400">{c.device_name}</span>
                        <span className="text-xs text-slate-400">{formatCurrency(c.daily_deduction)}/일</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 결과 */}
                {bulkPayResult && (
                  <div className={`rounded-lg p-4 ${bulkPayResult.remaining === 0 ? 'bg-green-900/30 border border-green-700/50' : 'bg-yellow-900/30 border border-yellow-700/50'}`}>
                    <p className="text-sm font-semibold text-white">처리 완료: {bulkPayResult.processed}건 계약 납부 반영</p>
                    {bulkPayResult.remaining > 0 && (
                      <p className="text-xs text-yellow-300 mt-1">미배분 잔액: {formatCurrency(bulkPayResult.remaining)} (차액 발생)</p>
                    )}
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-slate-700 flex justify-end gap-3">
                <button onClick={() => setBulkPayModal(null)}
                  className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">닫기</button>
                {!bulkPayResult ? (
                  <button
                    onClick={async () => {
                      if (!bulkPayForm.dateFrom || !bulkPayForm.dateTo) { alert('정산 기간을 입력해주세요.'); return; }
                      if (!inputAmt) { alert('입금액을 입력해주세요.'); return; }
                      setBulkPayProcessing(true);
                      const result = await onBulkDistributorPayment(
                        bulkPayModal.distributor, bulkPayForm.dateFrom, bulkPayForm.dateTo,
                        inputAmt, Array.from(bulkPayExclude)
                      );
                      setBulkPayResult(result || { processed: 0, remaining: inputAmt });
                      setBulkPayProcessing(false);
                    }}
                    disabled={bulkPayProcessing || !bulkPayForm.dateFrom || !bulkPayForm.dateTo || !inputAmt}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                  >
                    {bulkPayProcessing ? '처리 중...' : inputAmt === expectedTotal ? '전액 납부 처리' : '입금액 기준 처리'}
                  </button>
                ) : (
                  <button onClick={() => setBulkPayModal(null)}
                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">확인</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
