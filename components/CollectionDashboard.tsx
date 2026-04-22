import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency, formatDate } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

interface DailyMetric {
  metric_date: string;
  expected_amount: number;
  collected_amount: number;
  unpaid_amount: number;
}

interface RiskyDistributor {
  distributor_name: string;
  contract_count: number;
  max_overdue_days: number;
  total_unpaid: number;
  total_expected: number;
}

const CHART_TOOLTIP_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' };
const CHART_TICK = { fill: '#94a3b8', fontSize: 11 };

const KpiCard: React.FC<{ title: string; value: string; sub?: string; tone?: 'default' | 'good' | 'bad' | 'warn' }> = ({ title, value, sub, tone = 'default' }) => {
  const toneClass = {
    default: 'bg-slate-800 border-slate-700',
    good: 'bg-green-900/20 border-green-700/50',
    bad: 'bg-red-900/20 border-red-700/50',
    warn: 'bg-yellow-900/20 border-yellow-700/50',
  }[tone];
  return (
    <div className={`rounded-lg p-4 border ${toneClass}`}>
      <p className="text-xs text-slate-400">{title}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
};

export const CollectionDashboard: React.FC = () => {
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [riskyDist, setRiskyDist] = useState<RiskyDistributor[]>([]);
  const [loading, setLoading] = useState(true);

  // 기간 프리셋 적용
  useEffect(() => {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (preset === 'today') {
      setFromDate(fmt(today));
      setToDate(fmt(today));
    } else if (preset === 'week') {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      setFromDate(fmt(start));
      setToDate(fmt(today));
    } else if (preset === 'month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      setFromDate(fmt(start));
      setToDate(fmt(today));
    }
  }, [preset]);

  // 데이터 조회
  useEffect(() => {
    if (!fromDate || !toDate || !supabase) return;
    setLoading(true);
    const load = async () => {
      try {
        const [metricsRes, riskyRes] = await Promise.all([
          (supabase!.rpc as any)('get_daily_recovery_metrics', { from_date: fromDate, to_date: toDate }),
          (supabase!.rpc as any)('get_risky_distributors', { limit_count: 10 }),
        ]);
        setDailyMetrics(((metricsRes.data || []) as any[]).map(r => ({
          metric_date: r.metric_date,
          expected_amount: Number(r.expected_amount) || 0,
          collected_amount: Number(r.collected_amount) || 0,
          unpaid_amount: Number(r.unpaid_amount) || 0,
        })));
        setRiskyDist(((riskyRes.data || []) as any[]).map(r => ({
          distributor_name: r.distributor_name,
          contract_count: Number(r.contract_count) || 0,
          max_overdue_days: Number(r.max_overdue_days) || 0,
          total_unpaid: Number(r.total_unpaid) || 0,
          total_expected: Number(r.total_expected) || 0,
        })));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fromDate, toDate]);

  // 요약 KPI
  const kpi = useMemo(() => {
    const totalExpected = dailyMetrics.reduce((s, m) => s + m.expected_amount, 0);
    const totalCollected = dailyMetrics.reduce((s, m) => s + m.collected_amount, 0);
    const totalUnpaid = dailyMetrics.reduce((s, m) => s + m.unpaid_amount, 0);
    const rate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;
    return { totalExpected, totalCollected, totalUnpaid, rate };
  }, [dailyMetrics]);

  // 차트 데이터 (짧은 날짜 레이블)
  const chartData = useMemo(() => {
    return dailyMetrics.map(m => {
      const d = new Date(m.metric_date);
      return {
        name: `${d.getMonth() + 1}/${d.getDate()}`,
        예상: Math.round(m.expected_amount),
        수금: Math.round(m.collected_amount),
        미납: Math.round(m.unpaid_amount),
      };
    });
  }, [dailyMetrics]);

  return (
    <div className="bg-slate-800/60 rounded-xl p-6 border border-slate-700 space-y-5">
      {/* 헤더: 기간 선택 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-xl font-bold text-white">📊 회수 대시보드</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-900/50 rounded-lg p-1 gap-1">
            {[
              { key: 'today', label: '오늘' },
              { key: 'week', label: '이번 주' },
              { key: 'month', label: '이번 달' },
              { key: 'custom', label: '기간 지정' },
            ].map(p => (
              <button key={p.key} onClick={() => setPreset(p.key as PeriodPreset)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  preset === p.key ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-1">
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="bg-slate-700 text-white rounded px-2 py-1 text-xs" />
              <span className="text-slate-500 text-xs">~</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="bg-slate-700 text-white rounded px-2 py-1 text-xs" />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-indigo-500" />
        </div>
      ) : (
        <>
          {/* KPI 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              title="기간 내 예상 수금"
              value={formatCurrency(kpi.totalExpected)}
              sub={`${fromDate} ~ ${toDate}`}
            />
            <KpiCard
              title="실제 수금"
              value={formatCurrency(kpi.totalCollected)}
              sub={`회수율 ${kpi.rate.toFixed(1)}%`}
              tone={kpi.rate >= 80 ? 'good' : kpi.rate >= 50 ? 'warn' : 'bad'}
            />
            <KpiCard
              title="미납 금액"
              value={formatCurrency(kpi.totalUnpaid)}
              sub="회수 못한 금액"
              tone={kpi.totalUnpaid > 0 ? 'bad' : 'good'}
            />
            <KpiCard
              title="위험 총판"
              value={`${riskyDist.length}개`}
              sub="연체 중인 총판 수"
              tone={riskyDist.length > 5 ? 'bad' : riskyDist.length > 0 ? 'warn' : 'good'}
            />
          </div>

          {/* 일별 회수 차트 */}
          <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50">
            <h4 className="text-sm font-semibold text-slate-300 mb-3">일별 회수 현황</h4>
            {chartData.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">데이터가 없습니다.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={CHART_TICK} />
                  <YAxis tick={CHART_TICK} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="예상" fill="#64748b" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="수금" fill="#22c55e" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="미납" fill="#ef4444" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 위험 총판 TOP 10 */}
          <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-300">위험 총판 TOP 10 (연체일 기준)</h4>
              <span className="text-xs text-slate-500">전체 진행중 계약 기준</span>
            </div>
            {riskyDist.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">위험 총판이 없습니다. ✅</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700">
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">총판명</th>
                      <th className="p-2 text-center">계약 수</th>
                      <th className="p-2 text-center">최대 연체일</th>
                      <th className="p-2 text-right">미납액</th>
                      <th className="p-2 text-right">청구 총액</th>
                      <th className="p-2 text-center">납부율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskyDist.map((d, i) => {
                      const rate = d.total_expected > 0 ? ((d.total_expected - d.total_unpaid) / d.total_expected) * 100 : 100;
                      return (
                        <tr key={d.distributor_name} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                          <td className="p-2 text-slate-500">{i + 1}</td>
                          <td className="p-2 text-white font-medium">{d.distributor_name}</td>
                          <td className="p-2 text-center text-slate-300">{d.contract_count}건</td>
                          <td className="p-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                              d.max_overdue_days >= 14 ? 'bg-red-500/20 text-red-300' :
                              d.max_overdue_days >= 7 ? 'bg-yellow-500/20 text-yellow-300' :
                              'bg-slate-500/20 text-slate-300'
                            }`}>
                              {d.max_overdue_days}일
                            </span>
                          </td>
                          <td className="p-2 text-right text-red-400">{formatCurrency(d.total_unpaid)}</td>
                          <td className="p-2 text-right text-slate-300">{formatCurrency(d.total_expected)}</td>
                          <td className="p-2 text-center">
                            <span className={rate >= 80 ? 'text-green-400' : rate >= 50 ? 'text-yellow-400' : 'text-red-400'}>
                              {rate.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
