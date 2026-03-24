import React, { useState, useMemo } from 'react';
import { Contract, Partner, ContractStatus } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { computePaymentStats, classifyRisk, riskColors, RiskLevel } from '../lib/riskUtils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface CollectionManagementProps {
  contracts: Contract[];
  partners: Partner[];
}

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

type SortKey = 'paymentRate' | 'overdueDays' | 'balance' | 'totalAmount';

export const CollectionManagement: React.FC<CollectionManagementProps> = ({ contracts, partners }) => {
  const safeContracts = Array.isArray(contracts) ? contracts : [];
  const [riskFilter, setRiskFilter] = useState<RiskLevel | '전체'>('전체');
  const [keyword, setKeyword] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('paymentRate');
  const [sortAsc, setSortAsc] = useState(true);

  // Compute per-contract stats
  const contractStats = useMemo(() => {
    return safeContracts.map(c => {
      const stats = computePaymentStats(c);
      const risk = classifyRisk(stats.paymentRate, c.is_lawsuit);
      return { contract: c, ...stats, risk };
    });
  }, [safeContracts]);

  // Summary
  const summary = useMemo(() => {
    const totalAmount = contractStats.reduce((s, c) => s + c.totalAmount, 0);
    const totalPaidSum = contractStats.reduce((s, c) => s + c.totalPaid, 0);
    const overallRate = totalAmount > 0 ? (totalPaidSum / totalAmount) * 100 : 0;
    const overdueContracts = contractStats.filter(c => c.contract.status === ContractStatus.ACTIVE && c.overdueCount > 0).length;

    // 이번 달 회수 예정액
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const today = now.getDate();
    const remainingDays = lastDay - today;
    const monthlyExpected = safeContracts
      .filter(c => c.status === ContractStatus.ACTIVE)
      .reduce((s, c) => s + (Number(c.daily_deduction) || 0) * remainingDays, 0);

    return { overallRate, overdueContracts, monthlyExpected };
  }, [contractStats, safeContracts]);

  // Filtered & sorted
  const filtered = useMemo(() => {
    let result = contractStats;
    if (riskFilter !== '전체') result = result.filter(c => c.risk === riskFilter);
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      result = result.filter(c =>
        (c.contract.lessee_name || '').toLowerCase().includes(kw) ||
        (c.contract.distributor_name || '').toLowerCase().includes(kw) ||
        String(c.contract.contract_number).includes(kw)
      );
    }
    result.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return result;
  }, [contractStats, riskFilter, keyword, sortKey, sortAsc]);

  // Per-distributor chart
  const distributorChart = useMemo(() => {
    const map = new Map<string, { paid: number; total: number }>();
    contractStats.forEach(c => {
      const name = c.contract.distributor_name || '미지정';
      const prev = map.get(name) || { paid: 0, total: 0 };
      map.set(name, { paid: prev.paid + c.totalPaid, total: prev.total + c.totalAmount });
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name: name.length > 6 ? name.slice(0, 6) + '..' : name,
        납부율: v.total > 0 ? Math.round((v.paid / v.total) * 100) : 0,
      }))
      .sort((a, b) => a.납부율 - b.납부율)
      .slice(0, 20);
  }, [contractStats]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  const riskTabs: (RiskLevel | '전체')[] = ['전체', '정상', '주의', '위험', '소송중'];
  const riskCounts = useMemo(() => {
    const counts: Record<string, number> = { '전체': contractStats.length };
    contractStats.forEach(c => { counts[c.risk] = (counts[c.risk] || 0) + 1; });
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
          description="총 납부액 / 총 계약액"
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
          {riskTabs.map(tab => (
            <button key={tab} onClick={() => setRiskFilter(tab)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                riskFilter === tab ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}>
              {tab} ({riskCounts[tab] || 0})
            </button>
          ))}
        </div>
        <input type="text" placeholder="계약자명, 총판명 검색..."
          value={keyword} onChange={e => setKeyword(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
      </div>

      {/* Table */}
      <div className="bg-slate-800 rounded-lg shadow-lg border border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="text-left p-3 font-medium">계약자</th>
              <th className="text-left p-3 font-medium">총판</th>
              <th className="text-right p-3 font-medium cursor-pointer hover:text-white" onClick={() => handleSort('totalAmount')}>
                계약금액{sortIndicator('totalAmount')}
              </th>
              <th className="text-right p-3 font-medium">납부액</th>
              <th className="text-right p-3 font-medium cursor-pointer hover:text-white" onClick={() => handleSort('balance')}>
                잔액{sortIndicator('balance')}
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
              <tr key={row.contract.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                <td className="p-3 text-white">{row.contract.lessee_name || '-'}</td>
                <td className="p-3 text-slate-300">{row.contract.distributor_name || '-'}</td>
                <td className="p-3 text-right text-slate-300">{formatCurrency(row.totalAmount)}</td>
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
            ))}
          </tbody>
        </table>
      </div>

      {/* Distributor Chart */}
      {distributorChart.length > 0 && (
        <div className="bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
          <h3 className="text-lg font-semibold text-white mb-4">총판별 납부율</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={distributorChart} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} angle={-35} textAnchor="end" />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} domain={[0, 100]} unit="%" />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                formatter={(value: number) => [`${value}%`, '납부율']} />
              <Bar dataKey="납부율" radius={[4, 4, 0, 0]} maxBarSize={50}>
                {distributorChart.map((entry, idx) => (
                  <Cell key={idx} fill={entry.납부율 >= 80 ? '#22c55e' : entry.납부율 >= 50 ? '#eab308' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
