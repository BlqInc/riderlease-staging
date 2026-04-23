import React, { useEffect, useMemo, useState, lazy, Suspense, memo, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency, formatDate } from '../lib/utils';
import { UnpaidDetailPanel } from './UnpaidDetailPanel';
import { InfoTooltip } from './InfoTooltip';

// recharts는 무거우므로 lazy load (초기 대시보드 진입 속도 개선)
const LazyChart = lazy(() => import('./DashboardChart'));

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

interface DailyMetric {
  metric_date: string;
  expected_amount: number;
  collected_amount: number;
  unpaid_amount: number;
}

interface AttentionDistributor {
  distributor_name: string;
  contract_count: number;
  max_overdue_days: number;
  total_unpaid: number;
}

interface HealthSummary {
  total_contracts: number;
  healthy_active: number;
  overdue_active: number;
  expired_healthy: number;
  expired_unpaid: number;
  total_expected: number;
  total_paid: number;
  total_unpaid: number;
  monthly_forecast: number;
}

const KpiCard: React.FC<{ title: string; value: string; sub?: string; tone?: 'default' | 'good' | 'bad' | 'warn'; tooltip?: string }> = memo(({ title, value, sub, tone = 'default', tooltip }) => {
  const toneClass = {
    default: 'bg-slate-800 border-slate-700',
    good: 'bg-green-900/20 border-green-700/50',
    bad: 'bg-red-900/20 border-red-700/50',
    warn: 'bg-yellow-900/20 border-yellow-700/50',
  }[tone];
  return (
    <div className={`rounded-lg p-4 border ${toneClass}`}>
      <p className="text-xs text-slate-400 flex items-center gap-1">
        {title}
        {tooltip && <InfoTooltip text={tooltip} />}
      </p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
});

export const CollectionDashboard: React.FC = () => {
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [attentionDist, setAttentionDist] = useState<AttentionDistributor[]>([]);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showChart, setShowChart] = useState(true);
  const [selectedBar, setSelectedBar] = useState<{ fromDate: string; toDate: string; label: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 계약 시작일(execution_date) 코호트 필터
  const [execFrom, setExecFrom] = useState('');
  const [execTo, setExecTo] = useState('');
  const [showExecFilter, setShowExecFilter] = useState(false);
  // 기준일(anchor date): 기본 어제
  const [useToday, setUseToday] = useState(false);
  const anchorDate = useMemo(() => {
    const d = new Date();
    if (!useToday) d.setDate(d.getDate() - 1);
    // 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 KST에서 하루 밀릴 수 있음)
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, [useToday]);

  // 기간 프리셋 적용 (anchor_date 기준, 로컬 타임존 유지)
  useEffect(() => {
    const anchor = new Date(anchorDate + 'T00:00:00');
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    if (preset === 'today') {
      setFromDate(fmt(anchor));
      setToDate(fmt(anchor));
    } else if (preset === 'week') {
      // 기준일 포함 과거 7일 (예: 기준일 4/21 → 4/15 ~ 4/21)
      const start = new Date(anchor);
      start.setDate(start.getDate() - 6);
      setFromDate(fmt(start));
      setToDate(fmt(anchor));
    } else if (preset === 'month') {
      // 기준일이 속한 달의 1일부터 기준일까지
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      setFromDate(fmt(start));
      setToDate(fmt(anchor));
    }
  }, [preset, anchorDate]);

  // 데이터 조회 (fromDate/toDate 변경 시)
  useEffect(() => {
    if (!fromDate || !toDate || !supabase) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const metricsArgs: any = { from_date: fromDate, to_date: toDate };
        if (execFrom) metricsArgs.exec_from = execFrom;
        if (execTo) metricsArgs.exec_to = execTo;
        // health/attention은 기간 끝일(toDate) 기준으로 호출 → 기간 필터에 반응
        const periodAnchor = toDate || anchorDate;
        const healthArgs: any = { anchor_date: periodAnchor };
        if (execFrom) healthArgs.exec_from = execFrom;
        if (execTo) healthArgs.exec_to = execTo;
        const attentionArgs: any = { limit_count: 10, anchor_date: periodAnchor };
        const [metricsRes, attentionRes, healthRes] = await Promise.all([
          (supabase!.rpc as any)('get_daily_recovery_metrics', metricsArgs),
          (supabase!.rpc as any)('get_attention_distributors', attentionArgs),
          (supabase!.rpc as any)('get_contract_health_summary', healthArgs),
        ]);
        if (cancelled) return;
        setDailyMetrics(((metricsRes.data || []) as any[]).map(r => ({
          metric_date: r.metric_date,
          expected_amount: Number(r.expected_amount) || 0,
          collected_amount: Number(r.collected_amount) || 0,
          unpaid_amount: Number(r.unpaid_amount) || 0,
        })));
        setAttentionDist(((attentionRes.data || []) as any[]).map(r => ({
          distributor_name: r.distributor_name,
          contract_count: Number(r.contract_count) || 0,
          max_overdue_days: Number(r.max_overdue_days) || 0,
          total_unpaid: Number(r.total_unpaid) || 0,
        })));
        const h = (healthRes.data || [])[0];
        setHealth(h ? {
          total_contracts: Number(h.total_contracts) || 0,
          healthy_active: Number(h.healthy_active) || 0,
          overdue_active: Number(h.overdue_active) || 0,
          expired_healthy: Number(h.expired_healthy) || 0,
          expired_unpaid: Number(h.expired_unpaid) || 0,
          total_expected: Number(h.total_expected) || 0,
          total_paid: Number(h.total_paid) || 0,
          total_unpaid: Number(h.total_unpaid) || 0,
          monthly_forecast: Number(h.monthly_forecast) || 0,
        } : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [fromDate, toDate, execFrom, execTo, anchorDate, reloadKey]);

  // 요약 KPI
  const kpi = useMemo(() => {
    const totalExpected = dailyMetrics.reduce((s, m) => s + m.expected_amount, 0);
    const totalCollected = dailyMetrics.reduce((s, m) => s + m.collected_amount, 0);
    const totalUnpaid = dailyMetrics.reduce((s, m) => s + m.unpaid_amount, 0);
    const rate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;
    return { totalExpected, totalCollected, totalUnpaid, rate };
  }, [dailyMetrics]);

  // 차트 데이터 (짧은 날짜 레이블) - 너무 많은 데이터는 자동으로 요약
  const chartData = useMemo(() => {
    // 30일 이상은 주별 요약
    if (dailyMetrics.length > 30) {
      const weeks: { [key: string]: { expected: number; collected: number; unpaid: number; label: string; fromDate: string; toDate: string } } = {};
      dailyMetrics.forEach(m => {
        const d = new Date(m.metric_date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const key = weekStart.toISOString().slice(0, 10);
        if (!weeks[key]) {
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weeks[key] = {
            expected: 0, collected: 0, unpaid: 0,
            label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}주`,
            fromDate: key,
            toDate: weekEnd.toISOString().slice(0, 10),
          };
        }
        weeks[key].expected += m.expected_amount;
        weeks[key].collected += m.collected_amount;
        weeks[key].unpaid += m.unpaid_amount;
      });
      return Object.entries(weeks)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([_, w]) => ({
          name: w.label,
          fromDate: w.fromDate,
          toDate: w.toDate,
          예상: Math.round(w.expected),
          수금: Math.round(w.collected),
          미납: Math.round(w.unpaid),
        }));
    }
    return dailyMetrics.map(m => {
      const d = new Date(m.metric_date);
      return {
        name: `${d.getMonth() + 1}/${d.getDate()}`,
        fromDate: m.metric_date,
        toDate: m.metric_date,
        예상: Math.round(m.expected_amount),
        수금: Math.round(m.collected_amount),
        미납: Math.round(m.unpaid_amount),
      };
    });
  }, [dailyMetrics]);

  const handleBarClick = useCallback((d: { fromDate: string; toDate: string; name: string; 미납: number }) => {
    if (d.미납 <= 0) return;
    setSelectedBar({ fromDate: d.fromDate, toDate: d.toDate, label: d.name });
  }, []);

  return (
    <div className="bg-slate-800/60 rounded-xl p-6 border border-slate-700 space-y-5">
      {/* 헤더: 기준일 + 기간 선택 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xl font-bold text-white">📊 회수 대시보드</h3>
          <div className="flex items-center gap-1 bg-slate-900/50 rounded-lg p-1">
            <span className="text-xs text-slate-400 px-2">기준일</span>
            <button onClick={() => setUseToday(false)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                !useToday ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'
              }`}>어제</button>
            <button onClick={() => setUseToday(true)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                useToday ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'
              }`}>오늘</button>
            <span className="text-[10px] text-slate-500 px-1">({anchorDate})</span>
            <InfoTooltip text={`대시보드 모든 수치의 기준 시점입니다.\n\n• 어제(기본): 저녁 늦게 들어오는 입금이 반영될 시간 확보\n• 오늘: 실시간 확인용\n\n프리셋('이번 주' 등)은 기준일 과거 N일로 계산됩니다.`} />
          </div>
        </div>
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

      {/* 계약 시작일 코호트 필터 */}
      <div>
        <button onClick={() => setShowExecFilter(s => !s)}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-white">
          <span>{showExecFilter ? '▼' : '▶'}</span>
          <span>계약 시작일 필터</span>
          {(execFrom || execTo) && (
            <span className="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded text-[10px] font-medium">
              활성: {execFrom || '처음'} ~ {execTo || '끝'}
            </span>
          )}
        </button>
        {showExecFilter && (
          <div className="mt-2 flex items-center gap-2 flex-wrap bg-slate-900/40 rounded-lg p-3 border border-slate-700/50">
            <span className="text-xs text-slate-400">계약 시작일</span>
            <input type="date" value={execFrom} onChange={e => setExecFrom(e.target.value)}
              className="bg-slate-700 text-white rounded px-2 py-1 text-xs" />
            <span className="text-slate-500 text-xs">~</span>
            <input type="date" value={execTo} onChange={e => setExecTo(e.target.value)}
              className="bg-slate-700 text-white rounded px-2 py-1 text-xs" />
            {(execFrom || execTo) && (
              <button onClick={() => { setExecFrom(''); setExecTo(''); }}
                className="text-xs text-slate-400 hover:text-white bg-slate-700 px-2 py-1 rounded">
                초기화
              </button>
            )}
            <span className="text-[10px] text-slate-500">
              지정한 날짜 범위에 계약 시작(실행)된 건만 집계합니다
            </span>
          </div>
        )}
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
              tooltip={`선택한 기간 동안 받기로 예정된 일차감 금액의 합계입니다.\n기준: 차감 예정일이 기간 내인 daily_deductions.amount 의 합`}
            />
            <KpiCard
              title="실제 수금"
              value={formatCurrency(kpi.totalCollected)}
              sub={`회수율 ${kpi.rate.toFixed(1)}%`}
              tone={kpi.rate >= 80 ? 'good' : kpi.rate >= 50 ? 'warn' : 'bad'}
              tooltip={`기간 내 실제로 납부된 금액의 합입니다.\n회수율 = 실제 수금 ÷ 예상 수금\n80% 이상 녹색, 50~79% 노랑, 50% 미만 빨강`}
            />
            <KpiCard
              title="미납 금액"
              value={formatCurrency(kpi.totalUnpaid)}
              sub="회수 못한 금액"
              tone={kpi.totalUnpaid > 0 ? 'bad' : 'good'}
              tooltip={`기간 내 청구 중 아직 회수하지 못한 금액입니다.\n예상 수금 − 실제 수금 (납부완료가 아닌 차감의 미납분 합)`}
            />
            <KpiCard
              title="관리 유의 총판"
              value={`${attentionDist.length}개`}
              sub="21일+ 연체 & 조치 없음"
              tone={attentionDist.length > 5 ? 'bad' : attentionDist.length > 0 ? 'warn' : 'good'}
              tooltip={`21일 이상 연체된 계약이 있는데, 5가지 조치(문자/전화/신용정보사/형사고소/지연회수)가 모두 미체크인 총판.\n5개 초과 빨강, 1개 이상 노랑, 0개 녹색`}
            />
          </div>

          {/* KPI 2행: 기간 끝일(toDate) 기준 누적 지표 */}
          {health && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <KpiCard
                title="전체 납부율"
                value={`${health.total_expected > 0 ? (health.total_paid / health.total_expected * 100).toFixed(1) : '0.0'}%`}
                sub={`${toDate || anchorDate}까지 누적`}
                tone={health.total_expected === 0 ? 'default'
                  : (health.total_paid / health.total_expected) >= 0.8 ? 'good'
                  : (health.total_paid / health.total_expected) >= 0.5 ? 'warn' : 'bad'}
                tooltip={`기간 끝일까지 받기로 한 금액 중 실제 받은 비율.\n총 납부 ÷ 총 예상 × 100\n\n기간 필터(이번 주/이번 달/지정)에 따라 끝일이 변하면 같이 변합니다.\n계약 유효기간 내 차감만 집계.`}
              />
              <KpiCard
                title="8일+ 연체 건수"
                value={`${health.overdue_active}건`}
                sub={`${toDate || anchorDate} 기준`}
                tone={health.overdue_active > 0 ? 'bad' : 'good'}
                tooltip={`기간 끝일 기준 가장 오래된 미납이 8일 이상 연체된 계약 수.\n7일 이하는 정상 범주로 제외.\n\n기간 필터에 따라 시점이 변합니다.`}
              />
              <KpiCard
                title="기간 끝 월 회수 예정액"
                value={formatCurrency(health.monthly_forecast)}
                sub={`${toDate || anchorDate} 속한 달 남은 일수 기준`}
                tooltip={`기간 끝일이 속한 달의 남은 일수 × 계약별 일차감 합계.\n\n예) 기간 끝이 4/15면 남은 일수 15일 (4/16~4/30).\n각 계약 daily_deduction × 15 의 총합.`}
              />
            </div>
          )}

          {/* 계약 건전성 요약 */}
          {health && (
            <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1">
                  🏥 계약 건전성 (전체 {health.total_contracts}건 · 2025-10-01 이후 실행)
                  <InfoTooltip text={`2025-10-01 이후 실행된 모든 계약을 4가지로 분류합니다.\n\n• 진행중 정상: 미수 없음 또는 연체 7일 이하\n• 진행중 연체: 8일 이상 연체\n• 만료 정상종결: 만료 & 미수 없음\n• 만료 미수: 만료 & 미수 있음\n\n집계는 계약 유효기간 내 차감만 포함합니다.`} />
                </h4>
                {health.total_contracts > 0 && (
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    정상률 <span className="text-green-400 font-bold">
                      {((health.healthy_active + health.expired_healthy) / health.total_contracts * 100).toFixed(1)}%
                    </span>
                    <InfoTooltip text={`정상률 = (진행중 정상 + 만료 정상종결) ÷ 전체 계약 × 100\n즉 미수 없이 납부되고 있거나 종결된 계약 비율`} />
                  </span>
                )}
              </div>
              {/* 진행 바 */}
              <div className="flex h-6 rounded-md overflow-hidden mb-3">
                {health.total_contracts > 0 && (<>
                  {health.healthy_active > 0 && (
                    <div className="bg-green-500 flex items-center justify-center text-[10px] text-white font-bold"
                      style={{ width: `${(health.healthy_active / health.total_contracts) * 100}%` }}
                      title={`진행중 정상 ${health.healthy_active}건`}>
                      {health.healthy_active / health.total_contracts > 0.1 ? `${health.healthy_active}` : ''}
                    </div>
                  )}
                  {health.overdue_active > 0 && (
                    <div className="bg-yellow-500 flex items-center justify-center text-[10px] text-white font-bold"
                      style={{ width: `${(health.overdue_active / health.total_contracts) * 100}%` }}
                      title={`진행중 연체 ${health.overdue_active}건`}>
                      {health.overdue_active / health.total_contracts > 0.1 ? `${health.overdue_active}` : ''}
                    </div>
                  )}
                  {health.expired_healthy > 0 && (
                    <div className="bg-slate-500 flex items-center justify-center text-[10px] text-white font-bold"
                      style={{ width: `${(health.expired_healthy / health.total_contracts) * 100}%` }}
                      title={`만료 정상종결 ${health.expired_healthy}건`}>
                      {health.expired_healthy / health.total_contracts > 0.1 ? `${health.expired_healthy}` : ''}
                    </div>
                  )}
                  {health.expired_unpaid > 0 && (
                    <div className="bg-red-500 flex items-center justify-center text-[10px] text-white font-bold"
                      style={{ width: `${(health.expired_unpaid / health.total_contracts) * 100}%` }}
                      title={`만료 미수 ${health.expired_unpaid}건`}>
                      {health.expired_unpaid / health.total_contracts > 0.1 ? `${health.expired_unpaid}` : ''}
                    </div>
                  )}
                </>)}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-green-500" />
                  <div>
                    <p className="text-slate-400 flex items-center gap-1">
                      진행중 정상
                      <InfoTooltip text={`계약 기간이 아직 남았고 (만료일 > 오늘), 미수 없음 또는 연체 7일 이하인 계약`} />
                    </p>
                    <p className="text-green-400 font-bold">{health.healthy_active}건</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-yellow-500" />
                  <div>
                    <p className="text-slate-400 flex items-center gap-1">
                      진행중 연체
                      <InfoTooltip text={`계약 기간 내이지만 가장 오래된 미납이 8일 이상 연체된 계약.\n즉시 조치가 필요한 그룹입니다.`} />
                    </p>
                    <p className="text-yellow-400 font-bold">{health.overdue_active}건</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-slate-500" />
                  <div>
                    <p className="text-slate-400 flex items-center gap-1">
                      만료 정상종결
                      <InfoTooltip text={`만료일이 지났고 (만료일 < 오늘), 미수가 없는 계약.\n사실상 종결된 건입니다.`} />
                    </p>
                    <p className="text-slate-300 font-bold">{health.expired_healthy}건</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-red-500" />
                  <div>
                    <p className="text-slate-400 flex items-center gap-1">
                      만료 미수
                      <InfoTooltip text={`만료일이 지났는데 미수가 남은 계약.\n회수 관리 필수 대상입니다.`} />
                    </p>
                    <p className="text-red-400 font-bold">{health.expired_unpaid}건</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 일별 회수 차트 - 토글 가능 + lazy load */}
          <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1">
                일별 회수 현황
                <InfoTooltip text={`각 날짜 막대는 그 날짜에 청구 예정이었던 일차감 단위로 집계합니다.\n\n• 예상(회색): 그날 받기로 한 일차감 합\n• 수금(초록): 그날 차감 중 실제 납부된 금액\n• 미납(빨강): 그날 차감 중 아직 안 들어온 금액`} />
              </h4>
              <button onClick={() => setShowChart(s => !s)}
                className="text-xs text-slate-400 hover:text-white">
                {showChart ? '▲ 접기' : '▼ 펼치기'}
              </button>
            </div>
            {showChart && (
              <div className="bg-yellow-900/20 border border-yellow-700/40 rounded p-2.5 text-[11px] text-yellow-200 mb-3">
                ⚠️ <b>미납 해석 시 참고:</b> 일·주·월 단위 등 납부 주기가 다양해서, <b>주 1회·월 1회 납부 약정 차주</b>도 차감일이 매일 잡혀 있어 그 사이 날짜가 빨간색(미납)으로 보일 수 있어요.
                실제 약정대로 정상 납부 중이라도 다음 정기 납부일까지 미납으로 표시됩니다.
                <br/>막대를 클릭하면 어떤 계약자가 미납인지 상세 확인 가능합니다.
              </div>
            )}
            {showChart && (chartData.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">데이터가 없습니다.</p>
            ) : (
              <Suspense fallback={
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-indigo-500" />
                </div>
              }>
                <LazyChart data={chartData} onUnpaidClick={handleBarClick} />
              </Suspense>
            ))}

            {/* 미납 막대 클릭 시 상세 패널 */}
            {selectedBar && (
              <UnpaidDetailPanel
                fromDate={selectedBar.fromDate}
                toDate={selectedBar.toDate}
                label={selectedBar.label}
                execFrom={execFrom || undefined}
                execTo={execTo || undefined}
                anchorDate={anchorDate}
                onClose={() => setSelectedBar(null)}
                onProcessed={() => setReloadKey(k => k + 1)}
              />
            )}
          </div>

          {/* 관리 유의 총판 TOP 10 */}
          <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-slate-300 flex items-center gap-1">
                ⚠️ 관리 유의 총판 TOP 10
                <InfoTooltip text={`21일 이상 연체된 계약이 있는데 아무 조치도 취하지 않은 총판 TOP 10.\n\n기준:\n• 가장 오래된 미납이 21일 이상 연체\n• 5가지 조치(문자/전화/신용정보사/형사고소/지연회수) 모두 미체크\n\n정렬: 최대 연체일 내림차순 → 총 미수액 내림차순`} />
              </h4>
              <span className="text-xs text-slate-500">21일+ 연체 · 아직 조치 없음</span>
            </div>
            {attentionDist.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-8">유의 총판이 없습니다. ✅</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700">
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">총판명</th>
                      <th className="p-2 text-center">조치 필요 계약</th>
                      <th className="p-2 text-center">최대 연체일</th>
                      <th className="p-2 text-right">총 미수액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attentionDist.map((d, i) => (
                      <tr key={d.distributor_name} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                        <td className="p-2 text-slate-500">{i + 1}</td>
                        <td className="p-2 text-white font-medium">{d.distributor_name}</td>
                        <td className="p-2 text-center text-slate-300">{d.contract_count}건</td>
                        <td className="p-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            d.max_overdue_days >= 60 ? 'bg-red-500/30 text-red-200' :
                            d.max_overdue_days >= 30 ? 'bg-red-500/20 text-red-300' :
                            'bg-orange-500/20 text-orange-300'
                          }`}>
                            {d.max_overdue_days}일
                          </span>
                        </td>
                        <td className="p-2 text-right text-red-400">{formatCurrency(d.total_unpaid)}</td>
                      </tr>
                    ))}
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
