import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/utils';
import { InfoTooltip } from './InfoTooltip';

interface Batch {
  id: string;
  partner_names: string[];
  date_from: string;
  date_to: string;
  input_amount: number;
  total_distributed: number;
  remaining_amount: number;
  contract_count: number;
  deduction_count: number;
  algorithm: string;
  status: 'completed' | 'reverted';
  created_at: string;
  reverted_at: string | null;
}

interface Props {
  onAfterRevert?: () => void;
}

export const BulkPaymentHistory: React.FC<Props> = ({ onAfterRevert }) => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState<string | null>(null);
  const [tab, setTab] = useState<'history' | 'investigate'>('history');

  // 1번 정리 도우미 상태
  const [partnerKeyword, setPartnerKeyword] = useState('');
  const [searchMinutes, setSearchMinutes] = useState(60);
  const [investigateRows, setInvestigateRows] = useState<any[]>([]);
  const [investigating, setInvestigating] = useState(false);

  const load = useCallback(async () => {
    if (!supabase || !open) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase.from('bulk_payment_batches') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setBatches((data || []) as Batch[]);
    } catch (e: any) {
      alert(`이력 로드 실패: ${e.message}\n\n(테이블 없으면 sql_bulk_payment_audit.sql 실행 필요)`);
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => { load(); }, [load]);

  const handleRevert = async (batch: Batch) => {
    if (!supabase) return;
    if (!confirm(
      `[${batch.created_at.slice(0, 16).replace('T', ' ')}] 일괄 납부를 롤백할까요?\n\n` +
      `파트너: ${batch.partner_names.join(', ')}\n금액: ${formatCurrency(batch.input_amount)}\n계약: ${batch.contract_count}건 / 차감 ${batch.deduction_count}건\n\n` +
      `※ 롤백 이후 수동으로 변경된 차감은 자동 스킵됩니다.`
    )) return;

    setReverting(batch.id);
    try {
      const { data, error } = await (supabase.rpc as any)('revert_bulk_payment', { p_batch_id: batch.id });
      if (error) throw error;
      const result = data || {};
      alert(`✅ 롤백 완료\n복원: ${result.reverted}건\n스킵: ${result.skipped}건${
        result.skipped > 0 ? '\n\n(스킵된 항목은 그 사이 수동으로 변경되어 자동 복원이 안전하지 않은 경우입니다)' : ''
      }`);
      load();
      if (onAfterRevert) onAfterRevert();
    } catch (e: any) {
      alert(`롤백 실패: ${e.message}`);
    } finally {
      setReverting(null);
    }
  };

  // 1번 정리 — 과거 이상 데이터 식별
  const handleInvestigate = async () => {
    if (!supabase || !partnerKeyword.trim()) return;
    setInvestigating(true);
    try {
      const { data, error } = await (supabase.rpc as any)('find_recent_deduction_changes', {
        p_partner_keyword: partnerKeyword.trim(),
        p_minutes: searchMinutes,
      });
      if (error) throw error;
      setInvestigateRows((data || []) as any[]);
    } catch (e: any) {
      alert(`조회 실패: ${e.message}`);
    } finally {
      setInvestigating(false);
    }
  };

  // 1번 정리 — 일괄 리셋
  const handleResetAll = async () => {
    if (!supabase || !partnerKeyword.trim()) return;
    if (investigateRows.length === 0) {
      alert('먼저 [조회]를 실행해서 영향 범위를 확인해주세요.');
      return;
    }
    if (!confirm(
      `⚠️ 위험한 작업입니다.\n\n` +
      `'${partnerKeyword}' 파트너의 최근 ${searchMinutes}분 내 변경된 차감 ${investigateRows.length}건을 모두 paid_amount=0, status='미납'으로 되돌립니다.\n\n` +
      `※ 이 시간대에 정상적인 변경이 함께 있었다면 그것도 같이 리셋됩니다.\n계속 진행할까요?`
    )) return;
    if (!confirm('정말로 진행합니까? 한 번 더 확인합니다.')) return;

    try {
      const { data, error } = await (supabase.rpc as any)('reset_recent_deduction_changes', {
        p_partner_keyword: partnerKeyword.trim(),
        p_minutes: searchMinutes,
      });
      if (error) throw error;
      alert(`✅ 리셋 완료\n${data?.reset_count || 0}건의 차감이 미납으로 복원됐습니다.`);
      handleInvestigate();
      if (onAfterRevert) onAfterRevert();
    } catch (e: any) {
      alert(`리셋 실패: ${e.message}`);
    }
  };

  return (
    <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            🧾 일괄 납부 이력 + 롤백
            <InfoTooltip text={`최근 30개의 일괄 납부 기록.\n각 배치는 audit 기록되어 있어 안전하게 롤백 가능합니다.\n\n롤백 후 수동으로 변경된 차감은 자동 스킵됩니다 (보호장치).`} />
          </h4>
        </div>
        <button onClick={() => setOpen(o => !o)}
          className="text-xs text-slate-300 hover:text-white bg-slate-700 px-3 py-1 rounded">
          {open ? '▲ 닫기' : '▼ 열기'}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {/* 탭 */}
          <div className="flex gap-1 mb-3">
            <button onClick={() => setTab('history')}
              className={`px-3 py-1 text-xs rounded ${tab === 'history' ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              일괄 납부 이력
            </button>
            <button onClick={() => setTab('investigate')}
              className={`px-3 py-1 text-xs rounded ${tab === 'investigate' ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              과거 데이터 정리 도우미
            </button>
          </div>

          {tab === 'history' && (loading ? (
            <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-5 w-5 border-t-2 border-indigo-500" /></div>
          ) : batches.length === 0 ? (
            <p className="text-slate-500 text-xs text-center py-4">일괄 납부 이력이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-800">
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="p-2 text-left">시간</th>
                    <th className="p-2 text-left">파트너</th>
                    <th className="p-2 text-left">기간</th>
                    <th className="p-2 text-right">입금액</th>
                    <th className="p-2 text-right">분배</th>
                    <th className="p-2 text-right">잔여</th>
                    <th className="p-2 text-center">계약/차감</th>
                    <th className="p-2 text-center">상태</th>
                    <th className="p-2 text-center">롤백</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <td className="p-2 text-slate-400 whitespace-nowrap">{b.created_at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="p-2 text-slate-300">{b.partner_names?.join(', ') || '-'}</td>
                      <td className="p-2 text-slate-400">{b.date_from} ~ {b.date_to}</td>
                      <td className="p-2 text-right text-white">{formatCurrency(b.input_amount)}</td>
                      <td className="p-2 text-right text-green-400">{formatCurrency(b.total_distributed)}</td>
                      <td className="p-2 text-right text-yellow-400">{formatCurrency(b.remaining_amount)}</td>
                      <td className="p-2 text-center text-slate-400">{b.contract_count} / {b.deduction_count}</td>
                      <td className="p-2 text-center">
                        {b.status === 'completed' ? (
                          <span className="text-green-400">완료</span>
                        ) : (
                          <span className="text-slate-500">롤백됨<br/><span className="text-[10px]">{b.reverted_at?.slice(0, 16).replace('T', ' ')}</span></span>
                        )}
                      </td>
                      <td className="p-2 text-center">
                        {b.status === 'completed' && (
                          <button onClick={() => handleRevert(b)} disabled={reverting === b.id}
                            className="text-[10px] bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/50 px-2 py-0.5 rounded disabled:opacity-50">
                            {reverting === b.id ? '중...' : '롤백'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {tab === 'investigate' && (
            <div className="space-y-3">
              <div className="bg-yellow-900/20 border border-yellow-700/40 rounded p-3 text-xs text-yellow-200">
                ⚠️ <b>과거 audit 없던 시기의 일괄 납부 정리용입니다.</b> 파트너 키워드와 시간 범위를 지정해 최근 변경된 차감을 찾고, 일괄 리셋(미납으로 되돌림)할 수 있어요.
                <br/>리셋 시 정상 변경분도 함께 사라질 수 있으니 신중히 사용하세요.
              </div>
              <div className="flex gap-2 flex-wrap items-end">
                <div>
                  <label className="text-[10px] text-slate-400 block">파트너 키워드</label>
                  <input value={partnerKeyword} onChange={e => setPartnerKeyword(e.target.value)}
                    placeholder="예: 알피엠 배달대행"
                    className="bg-slate-700 text-white text-xs rounded p-2 w-48" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block">최근 ?분 내</label>
                  <input type="number" value={searchMinutes} onChange={e => setSearchMinutes(Number(e.target.value))}
                    className="bg-slate-700 text-white text-xs rounded p-2 w-24" />
                </div>
                <button onClick={handleInvestigate} disabled={investigating || !partnerKeyword.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs px-3 py-2 rounded">
                  {investigating ? '조회 중...' : '🔍 조회'}
                </button>
                {investigateRows.length > 0 && (
                  <button onClick={handleResetAll}
                    className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-2 rounded">
                    🚨 전체 리셋 ({investigateRows.length}건)
                  </button>
                )}
              </div>

              {investigateRows.length > 0 && (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="p-2 text-left">변경 시각</th>
                        <th className="p-2 text-left">계약자</th>
                        <th className="p-2 text-left">차감일</th>
                        <th className="p-2 text-right">amount</th>
                        <th className="p-2 text-right">paid_amount</th>
                        <th className="p-2 text-center">status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {investigateRows.map(r => (
                        <tr key={r.deduction_id_in_table} className="border-b border-slate-700/50">
                          <td className="p-2 text-slate-400">{r.updated_at?.slice(0, 16).replace('T', ' ')}</td>
                          <td className="p-2 text-white">{r.lessee_name} #{r.contract_number}</td>
                          <td className="p-2 text-slate-300">{r.due_date}</td>
                          <td className="p-2 text-right text-slate-300">{formatCurrency(r.amount)}</td>
                          <td className="p-2 text-right text-yellow-400">{formatCurrency(r.paid_amount)}</td>
                          <td className="p-2 text-center text-slate-400">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
