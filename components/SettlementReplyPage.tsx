import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/utils';

interface RequestItem {
  id: string;
  contract_id: string;
  contract_number: number | null;
  lessee_name: string | null;
  device_name: string | null;
  period_amount: number;
  excluded: boolean;
  excluded_reason: string | null;
  adjusted_amount: number | null;
}

interface RequestData {
  id: string;
  request_number: string;
  distributor_name: string;
  period_from: string;
  period_to: string;
  billing_amount: number;
  adjusted_amount: number | null;
  status: string; // draft|sent|replied|reconciled|completed|cancelled
  sent_at: string | null;
  replied_at: string | null;
  reply_memo: string | null;
  items: RequestItem[];
}

interface LocalItem {
  id: string;
  excluded: boolean;
  excluded_reason: string;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft:      { text: '발행 전', cls: 'bg-slate-600 text-slate-100' },
  sent:       { text: '회신 대기', cls: 'bg-amber-500/20 text-amber-300' },
  replied:    { text: '회신 완료', cls: 'bg-blue-500/20 text-blue-300' },
  reconciled: { text: '대사 완료', cls: 'bg-emerald-500/20 text-emerald-300' },
  completed:  { text: '입금 확인 완료', cls: 'bg-emerald-600 text-white' },
  cancelled:  { text: '취소', cls: 'bg-red-500/20 text-red-300' },
};

export const SettlementReplyPage: React.FC = () => {
  const token = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('settle_token') || '';
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RequestData | null>(null);
  const [localItems, setLocalItems] = useState<Record<string, LocalItem>>({});
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // 청구서 로드
  useEffect(() => {
    (async () => {
      if (!token || !supabase) {
        setError('잘못된 접근입니다 (토큰 없음).');
        setLoading(false);
        return;
      }
      try {
        const { data: rows, error: rpcErr } = await (supabase.rpc as any)('get_settlement_request_by_token', { p_token: token });
        if (rpcErr) throw rpcErr;
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row) { setError('청구서를 찾을 수 없습니다.'); setLoading(false); return; }
        const items: RequestItem[] = Array.isArray(row.items) ? row.items : [];
        setData({
          ...row,
          billing_amount: Number(row.billing_amount) || 0,
          adjusted_amount: row.adjusted_amount != null ? Number(row.adjusted_amount) : null,
          items,
        });
        // 로컬 상태 초기화 (기존 회신 반영)
        const lm: Record<string, LocalItem> = {};
        items.forEach(it => {
          lm[it.id] = {
            id: it.id,
            excluded: !!it.excluded,
            excluded_reason: it.excluded_reason || '',
          };
        });
        setLocalItems(lm);
        setMemo(row.reply_memo || '');
      } catch (e: any) {
        setError(e.message || '청구서 로드 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const adjustedTotal = useMemo(() => {
    if (!data) return 0;
    return data.items.reduce((sum, it) => {
      const li = localItems[it.id];
      if (li?.excluded) return sum;
      return sum + (Number(it.period_amount) || 0);
    }, 0);
  }, [data, localItems]);

  const toggleExclude = (id: string) => {
    setLocalItems(prev => ({
      ...prev,
      [id]: { ...prev[id], excluded: !prev[id]?.excluded },
    }));
  };

  const setReason = (id: string, reason: string) => {
    setLocalItems(prev => ({
      ...prev,
      [id]: { ...prev[id], excluded_reason: reason },
    }));
  };

  const handleSubmit = async () => {
    if (submitting || !supabase || !data) return;
    const payload = Object.values(localItems).map(li => ({
      item_id: li.id,
      excluded: li.excluded,
      excluded_reason: li.excluded ? (li.excluded_reason || null) : null,
    }));
    setSubmitting(true);
    try {
      const { data: res, error: rpcErr } = await (supabase.rpc as any)('submit_settlement_request_reply', {
        p_token: token,
        p_items: payload,
        p_memo: memo || null,
      });
      if (rpcErr) throw rpcErr;
      if (res && (res as any).ok === false) throw new Error((res as any).error || '회신 실패');
      setSubmitted(true);
    } catch (e: any) {
      alert('회신 실패: ' + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-300">
        로딩 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center text-slate-300 max-w-md p-6">
          <h2 className="text-xl font-semibold text-white mb-2">청구서를 열 수 없습니다</h2>
          <p className="text-sm text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const statusInfo = STATUS_LABEL[data.status] || { text: data.status, cls: 'bg-slate-600 text-slate-100' };
  const isReplied = submitted || ['replied', 'reconciled', 'completed'].includes(data.status);
  const isFinalized = ['completed', 'cancelled'].includes(data.status);
  const readonly = isFinalized;

  return (
    <div className="min-h-screen bg-slate-900 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-slate-800 rounded-xl border border-slate-700 shadow-2xl overflow-hidden">
        {/* 헤더 */}
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-5 text-white">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold">정산요청서</h1>
              <p className="text-indigo-200 text-sm mt-1">(주)비엘큐</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusInfo.cls}`}>
              {statusInfo.text}
            </span>
          </div>
        </div>

        {/* 청구서 메타 */}
        <div className="p-6 border-b border-slate-700 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-slate-400 text-xs">청구번호</div>
            <div className="text-white font-mono mt-0.5">{data.request_number}</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs">총판</div>
            <div className="text-white mt-0.5">{data.distributor_name}</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs">청구 기간</div>
            <div className="text-white mt-0.5">{data.period_from} ~ {data.period_to}</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs">발송일</div>
            <div className="text-white mt-0.5">{data.sent_at ? new Date(data.sent_at).toLocaleString('ko-KR') : '-'}</div>
          </div>
        </div>

        {/* 청구액 박스 */}
        <div className="p-6 bg-slate-900/50 border-b border-slate-700">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-slate-400 text-xs">원래 청구액</div>
              <div className="text-2xl text-slate-300 mt-1">₩{formatCurrency(data.billing_amount)}</div>
            </div>
            <div className="text-right">
              <div className="text-slate-400 text-xs">{isReplied ? '회신 조정액' : '조정 후 입금 예정액'}</div>
              <div className="text-3xl font-bold text-emerald-400 mt-1">
                ₩{formatCurrency(isReplied && data.adjusted_amount != null ? data.adjusted_amount : adjustedTotal)}
              </div>
            </div>
          </div>
        </div>

        {/* 항목 리스트 */}
        <div className="p-6">
          <h2 className="text-white font-semibold mb-3">청구 항목 ({data.items.length}건)</h2>
          {!isReplied && (
            <p className="text-xs text-slate-400 mb-3">
              회수하지 못한 계약은 <span className="text-orange-300">[제외]</span> 체크하고 사유를 입력해주세요.
              제외한 금액은 조정 후 입금 예정액에서 빠집니다.
            </p>
          )}
          <div className="space-y-2">
            {data.items.map(it => {
              const li = localItems[it.id];
              const excluded = li?.excluded || false;
              return (
                <div key={it.id} className={`rounded-lg p-3 border ${excluded ? 'bg-slate-900/40 border-slate-700 opacity-60' : 'bg-slate-900/70 border-slate-600'}`}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-slate-400">#{it.contract_number}</span>
                        <span className="text-white font-medium">{it.lessee_name}</span>
                        <span className="text-xs text-slate-400">{it.device_name}</span>
                      </div>
                      {!readonly && (
                        <label className="flex items-center gap-2 mt-2 cursor-pointer">
                          <input type="checkbox" checked={excluded}
                            onChange={() => toggleExclude(it.id)}
                            disabled={isReplied && !submitted}
                            className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-700 text-orange-500" />
                          <span className="text-xs text-orange-300">제외 요청</span>
                        </label>
                      )}
                      {excluded && (
                        <input type="text" placeholder="제외 사유 (예: 7일 회수 실패)"
                          value={li?.excluded_reason || ''}
                          onChange={e => setReason(it.id, e.target.value)}
                          disabled={readonly || (isReplied && !submitted)}
                          className="w-full mt-2 text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white placeholder-slate-500" />
                      )}
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div className={`font-semibold ${excluded ? 'text-slate-500 line-through' : 'text-emerald-400'}`}>
                        ₩{formatCurrency(it.period_amount)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 메모 */}
        {!readonly && (
          <div className="p-6 border-t border-slate-700">
            <label className="text-xs text-slate-400 block mb-1">회신 메모 (선택)</label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)}
              disabled={isReplied && !submitted}
              rows={3} placeholder="추가로 전달하실 내용을 입력해주세요"
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500 resize-none" />
          </div>
        )}

        {readonly && data.reply_memo && (
          <div className="p-6 border-t border-slate-700">
            <div className="text-xs text-slate-400 mb-1">회신 메모</div>
            <div className="text-sm text-slate-200 whitespace-pre-wrap">{data.reply_memo}</div>
          </div>
        )}

        {/* 액션 */}
        <div className="p-6 bg-slate-900/30 border-t border-slate-700">
          {isFinalized ? (
            <div className="text-center text-sm text-slate-300">
              {data.status === 'completed' ? '✅ 입금 확인이 완료되었습니다.' : '취소된 청구서입니다.'}
            </div>
          ) : submitted || isReplied ? (
            <div className="text-center text-sm text-emerald-300">
              ✅ 회신이 접수되었습니다. 통장으로 위 금액 입금 후 별도 안내가 발송됩니다.
            </div>
          ) : (
            <button onClick={handleSubmit} disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors">
              {submitting ? '제출 중...' : `회신 보내기 — 입금 예정 ₩${formatCurrency(adjustedTotal)}`}
            </button>
          )}
        </div>
      </div>

      <div className="text-center text-xs text-slate-500 mt-6">
        본 청구서는 (주)비엘큐에서 발행한 정산요청서입니다.<br />
        문의: 070-5220-1218
      </div>
    </div>
  );
};
