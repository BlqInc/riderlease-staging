import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency, formatDate } from '../lib/utils';
import { InfoTooltip } from './InfoTooltip';

interface UnpaidContract {
  contract_id: string;
  contract_number: number;
  lessee_name: string;
  distributor_name: string;
  partner_name: string;
  execution_date: string | null;
  expiry_date: string | null;
  days_since_expiry: number | null;
  is_expired: boolean;
  max_overdue_days: number;
  total_unpaid: number;
  sms_sent: boolean;
  call_made: boolean;
  credit_agency_sent: boolean;
  criminal_complaint: boolean;
  delayed_recovery: boolean;
  memo: string | null;
}

type ActionKey = 'sms_sent' | 'call_made' | 'credit_agency_sent' | 'criminal_complaint' | 'delayed_recovery';
type TabMode = 'expired' | 'active';

const ACTION_LABELS: { key: ActionKey; label: string; color: string }[] = [
  { key: 'sms_sent', label: '문자 안내', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { key: 'call_made', label: '전화 안내', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  { key: 'credit_agency_sent', label: '신용정보사 이송', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { key: 'criminal_complaint', label: '형사 고소', color: 'bg-red-500/20 text-red-300 border-red-500/40' },
  { key: 'delayed_recovery', label: '지연 회수 시작', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
];

export const ExpiredCollectionActions: React.FC = () => {
  const [contracts, setContracts] = useState<UnpaidContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState<ActionKey | 'all' | 'none'>('all');
  const [tabMode, setTabMode] = useState<TabMode>('expired');
  const [memoEditing, setMemoEditing] = useState<string | null>(null);
  const [memoValue, setMemoValue] = useState('');
  const [payEditing, setPayEditing] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);

  const fetchData = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)('get_unpaid_contracts_all');
      if (error) throw error;
      setContracts(((data || []) as any[]).map(r => ({
        contract_id: r.contract_id,
        contract_number: Number(r.contract_number) || 0,
        lessee_name: r.lessee_name || '',
        distributor_name: r.distributor_name || '',
        partner_name: r.partner_name || '',
        execution_date: r.execution_date || null,
        expiry_date: r.expiry_date || null,
        days_since_expiry: r.days_since_expiry == null ? null : Number(r.days_since_expiry),
        is_expired: !!r.is_expired,
        max_overdue_days: Number(r.max_overdue_days) || 0,
        total_unpaid: Number(r.total_unpaid) || 0,
        sms_sent: !!r.sms_sent,
        call_made: !!r.call_made,
        credit_agency_sent: !!r.credit_agency_sent,
        criminal_complaint: !!r.criminal_complaint,
        delayed_recovery: !!r.delayed_recovery,
        memo: r.memo || null,
      })));
    } catch (e: any) {
      console.error(e);
      alert(`데이터 로드 실패: ${e.message}\n\n(RPC get_unpaid_contracts_all 이 DB에 없을 수 있어요. sql_unpaid_contracts_all.sql 을 실행해주세요.)`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const toggleAction = async (contract: UnpaidContract, key: ActionKey) => {
    if (!supabase) return;
    const newValue = !contract[key];
    // 낙관적 업데이트
    setContracts(prev => prev.map(c => c.contract_id === contract.contract_id ? { ...c, [key]: newValue } : c));
    try {
      const updatePayload: any = { contract_id: contract.contract_id, [key]: newValue, updated_at: new Date().toISOString() };
      // 기존 행 있는지 upsert
      await (supabase.from('expired_collection_actions') as any).upsert(updatePayload, { onConflict: 'contract_id' });
    } catch (e: any) {
      alert(`저장 실패: ${e.message}`);
      // 롤백
      setContracts(prev => prev.map(c => c.contract_id === contract.contract_id ? { ...c, [key]: !newValue } : c));
    }
  };

  // 만료 계약 입금 처리 - 오래된 미납부터 순차 분배
  const handlePay = async (contract: UnpaidContract) => {
    if (!supabase) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { alert('금액을 입력해주세요.'); return; }
    if (amount > contract.total_unpaid * 1.01) {
      if (!confirm(`입금액(${formatCurrency(amount)})이 미수액(${formatCurrency(contract.total_unpaid)})보다 큽니다.\n그래도 처리할까요? (초과분은 무시됩니다)`)) return;
    }

    setPaying(true);
    try {
      // 1) 해당 계약의 미납 차감들 가져오기 (오래된 순)
      const { data: deds, error: e1 } = await (supabase.from('daily_deductions') as any)
        .select('id, due_date, amount, paid_amount, status')
        .eq('contract_id', contract.contract_id)
        .neq('status', '납부완료')
        .order('due_date', { ascending: true });
      if (e1) throw e1;

      // 2) 오래된 순으로 분배
      let remaining = amount;
      const updates: { id: string; paid_amount: number; status: string }[] = [];
      for (const d of deds || []) {
        if (remaining <= 0) break;
        const owed = Number(d.amount) - Number(d.paid_amount);
        if (owed <= 0) continue;
        const pay = Math.min(remaining, owed);
        remaining -= pay;
        const newPaid = Number(d.paid_amount) + pay;
        updates.push({
          id: d.id,
          paid_amount: newPaid,
          status: newPaid >= Number(d.amount) ? '납부완료' : '부분납부',
        });
      }

      if (updates.length === 0) {
        alert('처리할 미납 차감이 없습니다.');
        return;
      }

      // 3) 병렬 업데이트 (5개씩)
      for (let i = 0; i < updates.length; i += 5) {
        const batch = updates.slice(i, i + 5);
        await Promise.all(batch.map(u =>
          (supabase!.from('daily_deductions') as any).update({
            paid_amount: u.paid_amount, status: u.status,
          }).eq('id', u.id)
        ));
      }

      // 4) bank_deposits 기록 (수동 입금)
      const today = new Date().toISOString().split('T')[0];
      await (supabase.from('bank_deposits') as any).insert({
        deposit_date: today,
        depositor_name: `${contract.lessee_name} (만료계약 수동입금)`,
        amount: amount - remaining,
        salesperson_id: null,
        status: 'matched',
        matched_amount: amount - remaining,
        remaining_amount: remaining,
        processed_at: new Date().toISOString(),
        memo: `만료 계약 #${contract.contract_number} 미수 처리`,
      });

      alert(`✅ 입금 처리 완료\n${updates.length}건 차감에 ${formatCurrency(amount - remaining)} 분배${remaining > 0 ? ` (미배분 ${formatCurrency(remaining)})` : ''}`);
      setPayEditing(null);
      setPayAmount('');
      await fetchData();
    } catch (e: any) {
      alert(`입금 처리 실패: ${e.message}`);
    } finally {
      setPaying(false);
    }
  };

  const saveMemo = async (contract: UnpaidContract) => {
    if (!supabase) return;
    const trimmed = memoValue.trim() || null;
    try {
      await (supabase.from('expired_collection_actions') as any).upsert({
        contract_id: contract.contract_id,
        memo: trimmed,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'contract_id' });
      setContracts(prev => prev.map(c => c.contract_id === contract.contract_id ? { ...c, memo: trimmed } : c));
      setMemoEditing(null);
      setMemoValue('');
    } catch (e: any) {
      alert(`저장 실패: ${e.message}`);
    }
  };

  // 탭으로 먼저 분할 (만료 / 비만료)
  const byTab = useMemo(
    () => contracts.filter(c => tabMode === 'expired' ? c.is_expired : !c.is_expired),
    [contracts, tabMode]
  );

  const tabCounts = useMemo(() => ({
    expired: contracts.filter(c => c.is_expired).length,
    active: contracts.filter(c => !c.is_expired).length,
  }), [contracts]);

  const filtered = useMemo(() => {
    let list = byTab;
    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      list = list.filter(c =>
        c.lessee_name.toLowerCase().includes(kw) ||
        c.distributor_name.toLowerCase().includes(kw) ||
        String(c.contract_number).includes(kw)
      );
    }
    if (filterAction === 'none') {
      list = list.filter(c => !c.sms_sent && !c.call_made && !c.credit_agency_sent && !c.criminal_complaint && !c.delayed_recovery);
    } else if (filterAction !== 'all') {
      list = list.filter(c => c[filterAction]);
    }
    return list;
  }, [byTab, search, filterAction]);

  const stats = useMemo(() => {
    const totalUnpaid = byTab.reduce((s, c) => s + c.total_unpaid, 0);
    const untouched = byTab.filter(c =>
      !c.sms_sent && !c.call_made && !c.credit_agency_sent && !c.criminal_complaint && !c.delayed_recovery
    ).length;
    return { count: byTab.length, totalUnpaid, untouched };
  }, [byTab]);

  // 이름별 그룹 (2건 이상일 때만 묶음 헤더 표시)
  const grouped = useMemo(() => {
    const map = new Map<string, UnpaidContract[]>();
    filtered.forEach(c => {
      const key = c.lessee_name || '(이름 없음)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    });
    return Array.from(map.entries()).sort((a, b) => {
      // 여러 계약 가진 이름부터 상단, 이름은 그대로 유지
      if (a[1].length !== b[1].length) return b[1].length - a[1].length;
      return 0;
    });
  }, [filtered]);

  const [collapsedNames, setCollapsedNames] = useState<Set<string>>(new Set());
  const toggleCollapse = (name: string) => {
    setCollapsedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="bg-slate-800/60 rounded-xl p-6 border border-slate-700 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            🚨 미수 계약 회수 관리
            <InfoTooltip text={`미수가 남은 계약을 '만료' / '비만료' 탭으로 나누어 조치할 수 있습니다.\n\n• 만료 탭: 만료일 < 오늘 이면서 미수가 남은 모든 계약\n• 비만료 탭: 만료일 ≥ 오늘 이고 가장 오래된 미납이 8일 이상 연체\n\n2025-10-01 이후 실행된 계약만 대상입니다.`} />
          </h3>
          <p className="text-xs text-slate-500 mt-1">미수가 남은 모든 계약 (만료/비만료 분리)</p>
        </div>
        <button onClick={fetchData} className="text-xs text-slate-400 hover:text-white bg-slate-700 px-3 py-1.5 rounded">
          🔄 새로고침
        </button>
      </div>

      {/* 탭: 만료 / 비만료 */}
      <div className="flex bg-slate-900/50 rounded-lg p-1 gap-1 w-fit">
        <InfoTooltip text="만료일이 지났는데 미수가 남은 모든 계약" placement="bottom">
          <button onClick={() => setTabMode('expired')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              tabMode === 'expired' ? 'bg-red-600 text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}>
            만료 ({tabCounts.expired})
          </button>
        </InfoTooltip>
        <InfoTooltip text="계약 기간 내이지만 가장 오래된 미납이 8일 이상 연체된 계약" placement="bottom">
          <button onClick={() => setTabMode('active')}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              tabMode === 'active' ? 'bg-yellow-600 text-white font-bold' : 'text-slate-400 hover:text-white'
            }`}>
            비만료 ({tabCounts.active})
          </button>
        </InfoTooltip>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
          <p className="text-xs text-slate-400">{tabMode === 'expired' ? '만료 미수 계약' : '비만료 미수 계약'}</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.count}건</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-red-700/30">
          <p className="text-xs text-slate-400">총 미수액</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{formatCurrency(stats.totalUnpaid)}</p>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 border border-yellow-700/30">
          <p className="text-xs text-slate-400">아직 조치 없는 계약</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">{stats.untouched}건</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="계약자/총판/계약번호 검색..."
          className="bg-slate-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 max-w-xs"
        />
        <div className="flex bg-slate-900/50 rounded-lg p-1 gap-1 flex-wrap">
          <button onClick={() => setFilterAction('all')}
            className={`px-2 py-1 text-xs rounded ${filterAction === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
            전체
          </button>
          <button onClick={() => setFilterAction('none')}
            className={`px-2 py-1 text-xs rounded ${filterAction === 'none' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
            조치 없음
          </button>
          {ACTION_LABELS.map(a => (
            <button key={a.key} onClick={() => setFilterAction(a.key)}
              className={`px-2 py-1 text-xs rounded ${filterAction === a.key ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-indigo-500" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">
          해당하는 {tabMode === 'expired' ? '만료' : '비만료'} 계약이 없습니다.
        </p>
      ) : (
        <div className="space-y-3 max-h-[600px] overflow-y-auto">
          {grouped.map(([name, group]) => {
            const isMulti = group.length >= 2;
            const collapsed = collapsedNames.has(name);
            const groupTotalUnpaid = group.reduce((s, c) => s + c.total_unpaid, 0);
            const groupMaxOverdue = Math.max(...group.map(c => c.max_overdue_days));
            return (
              <div key={name} className={isMulti ? 'bg-slate-900/20 rounded-lg border border-slate-700/30 p-2' : ''}>
                {isMulti && (
                  <button onClick={() => toggleCollapse(name)}
                    className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-slate-800/40 rounded transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs">{collapsed ? '▶' : '▼'}</span>
                      <span className="text-white font-semibold">{name}</span>
                      <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded">
                        {group.length}건
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-400">최장 연체 <span className="text-red-400 font-bold">{groupMaxOverdue}일</span></span>
                      <span className="text-slate-400">총 미수 <span className="text-red-400 font-bold">{formatCurrency(groupTotalUnpaid)}</span></span>
                    </div>
                  </button>
                )}
                {!collapsed && (
                  <div className={`space-y-2 ${isMulti ? 'mt-2 pl-4 border-l-2 border-slate-700/50' : ''}`}>
                    {group.map(c => (
            <div key={c.contract_id} className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/50">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold">{c.lessee_name}</span>
                    <span className="text-slate-500 text-sm">#{c.contract_number}</span>
                    <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{c.distributor_name}</span>
                    {c.is_expired ? (
                      <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded font-medium">
                        만료 {c.days_since_expiry}일 경과
                      </span>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        c.max_overdue_days >= 14 ? 'bg-red-500/20 text-red-300'
                        : c.max_overdue_days >= 8 ? 'bg-orange-500/20 text-orange-300'
                        : 'bg-yellow-500/20 text-yellow-300'
                      }`}>
                        연체 {c.max_overdue_days}일
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {c.execution_date ? `실행일 ${formatDate(c.execution_date)} · ` : ''}
                    {c.expiry_date ? `만료일 ${formatDate(c.expiry_date)} · ` : ''}
                    미수액 <span className="text-red-400 font-semibold">{formatCurrency(c.total_unpaid)}</span>
                  </p>
                </div>
                {/* 입금 처리 버튼/입력 */}
                {payEditing === c.contract_id ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                      placeholder="입금액"
                      className="bg-slate-700 text-white text-sm rounded px-2 py-1 w-32 focus:outline-none focus:ring-1 focus:ring-green-500"
                      autoFocus />
                    <button onClick={() => handlePay(c)} disabled={paying}
                      className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 rounded">
                      {paying ? '처리 중...' : '입금'}
                    </button>
                    <button onClick={() => { setPayEditing(null); setPayAmount(''); }}
                      className="text-xs text-slate-400 hover:text-slate-300 px-2">✕</button>
                  </div>
                ) : (
                  <button onClick={() => { setPayEditing(c.contract_id); setPayAmount(String(c.total_unpaid)); }}
                    className="text-xs bg-green-600/20 text-green-300 border border-green-500/40 hover:bg-green-600/30 px-3 py-1 rounded">
                    💰 입금 처리
                  </button>
                )}
              </div>

              {/* 액션 체크박스 */}
              <div className="flex items-center gap-2 flex-wrap mt-3">
                {ACTION_LABELS.map(a => {
                  const checked = c[a.key];
                  return (
                    <button key={a.key} onClick={() => toggleAction(c, a.key)}
                      className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded border transition-colors ${
                        checked ? a.color : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-500'
                      }`}>
                      <span>{checked ? '✓' : '○'}</span>
                      <span>{a.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 메모 */}
              <div className="mt-2">
                {memoEditing === c.contract_id ? (
                  <div className="flex gap-2">
                    <textarea value={memoValue} onChange={e => setMemoValue(e.target.value)}
                      placeholder="메모 입력..."
                      className="flex-1 bg-slate-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                      rows={2} />
                    <div className="flex flex-col gap-1">
                      <button onClick={() => saveMemo(c)} className="text-xs bg-indigo-600 text-white px-3 py-1 rounded">저장</button>
                      <button onClick={() => { setMemoEditing(null); setMemoValue(''); }} className="text-xs text-slate-400">취소</button>
                    </div>
                  </div>
                ) : c.memo ? (
                  <div className="flex items-start gap-2 bg-slate-800/50 rounded p-2">
                    <p className="flex-1 text-xs text-slate-300 whitespace-pre-wrap">{c.memo}</p>
                    <button onClick={() => { setMemoEditing(c.contract_id); setMemoValue(c.memo || ''); }}
                      className="text-xs text-yellow-400 hover:text-yellow-300">수정</button>
                  </div>
                ) : (
                  <button onClick={() => { setMemoEditing(c.contract_id); setMemoValue(''); }}
                    className="text-xs text-slate-500 hover:text-slate-300">+ 메모 추가</button>
                )}
              </div>
            </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
