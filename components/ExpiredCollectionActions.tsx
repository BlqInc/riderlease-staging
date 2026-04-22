import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency, formatDate } from '../lib/utils';

interface ExpiredContract {
  contract_id: string;
  contract_number: number;
  lessee_name: string;
  distributor_name: string;
  partner_name: string;
  expiry_date: string;
  days_since_expiry: number;
  total_unpaid: number;
  sms_sent: boolean;
  call_made: boolean;
  credit_agency_sent: boolean;
  criminal_complaint: boolean;
  delayed_recovery: boolean;
  memo: string | null;
}

type ActionKey = 'sms_sent' | 'call_made' | 'credit_agency_sent' | 'criminal_complaint' | 'delayed_recovery';

const ACTION_LABELS: { key: ActionKey; label: string; color: string }[] = [
  { key: 'sms_sent', label: '문자 안내', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  { key: 'call_made', label: '전화 안내', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  { key: 'credit_agency_sent', label: '신용정보사 이송', color: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { key: 'criminal_complaint', label: '형사 고소', color: 'bg-red-500/20 text-red-300 border-red-500/40' },
  { key: 'delayed_recovery', label: '지연 회수 시작', color: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
];

export const ExpiredCollectionActions: React.FC = () => {
  const [contracts, setContracts] = useState<ExpiredContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterAction, setFilterAction] = useState<ActionKey | 'all' | 'none'>('all');
  const [memoEditing, setMemoEditing] = useState<string | null>(null);
  const [memoValue, setMemoValue] = useState('');

  const fetchData = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)('get_expired_unpaid_contracts');
      if (error) throw error;
      setContracts(((data || []) as any[]).map(r => ({
        contract_id: r.contract_id,
        contract_number: Number(r.contract_number) || 0,
        lessee_name: r.lessee_name || '',
        distributor_name: r.distributor_name || '',
        partner_name: r.partner_name || '',
        expiry_date: r.expiry_date,
        days_since_expiry: Number(r.days_since_expiry) || 0,
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const toggleAction = async (contract: ExpiredContract, key: ActionKey) => {
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

  const saveMemo = async (contract: ExpiredContract) => {
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

  const filtered = useMemo(() => {
    let list = contracts;
    // 검색
    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      list = list.filter(c =>
        c.lessee_name.toLowerCase().includes(kw) ||
        c.distributor_name.toLowerCase().includes(kw) ||
        String(c.contract_number).includes(kw)
      );
    }
    // 액션 필터
    if (filterAction === 'none') {
      list = list.filter(c => !c.sms_sent && !c.call_made && !c.credit_agency_sent && !c.criminal_complaint && !c.delayed_recovery);
    } else if (filterAction !== 'all') {
      list = list.filter(c => c[filterAction]);
    }
    return list;
  }, [contracts, search, filterAction]);

  const stats = useMemo(() => {
    const totalUnpaid = contracts.reduce((s, c) => s + c.total_unpaid, 0);
    const untouched = contracts.filter(c =>
      !c.sms_sent && !c.call_made && !c.credit_agency_sent && !c.criminal_complaint && !c.delayed_recovery
    ).length;
    return { count: contracts.length, totalUnpaid, untouched };
  }, [contracts]);

  return (
    <div className="bg-slate-800/60 rounded-xl p-6 border border-slate-700 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold text-white">🚨 만료 계약 회수 관리</h3>
          <p className="text-xs text-slate-500 mt-1">계약 기간은 종료됐으나 미수가 남은 계약들</p>
        </div>
        <button onClick={fetchData} className="text-xs text-slate-400 hover:text-white bg-slate-700 px-3 py-1.5 rounded">
          🔄 새로고침
        </button>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
          <p className="text-xs text-slate-400">전체 만료 미수 계약</p>
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
        <p className="text-slate-500 text-sm text-center py-8">해당하는 만료 계약이 없습니다.</p>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {filtered.map(c => (
            <div key={c.contract_id} className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/50">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold">{c.lessee_name}</span>
                    <span className="text-slate-500 text-sm">#{c.contract_number}</span>
                    <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{c.distributor_name}</span>
                    <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded font-medium">
                      만료 {c.days_since_expiry}일 경과
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    만료일 {formatDate(c.expiry_date)} · 미수액 <span className="text-red-400 font-semibold">{formatCurrency(c.total_unpaid)}</span>
                  </p>
                </div>
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
};
