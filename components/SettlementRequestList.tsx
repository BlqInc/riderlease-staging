import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/utils';

interface SettlementRequest {
  id: string;
  request_number: string;
  distributor_partner_id: string | null;
  distributor_name: string;
  distributor_contact: string | null;
  period_from: string;
  period_to: string;
  billing_amount: number;
  adjusted_amount: number | null;
  paid_amount: number | null;
  status: string;
  token: string;
  sent_at: string | null;
  replied_at: string | null;
  completed_at: string | null;
  reply_memo: string | null;
  admin_memo: string | null;
  created_at: string;
}

interface SettlementItem {
  id: string;
  request_id: string;
  contract_id: string;
  contract_number: number | null;
  lessee_name: string | null;
  device_name: string | null;
  period_amount: number;
  excluded: boolean;
  excluded_reason: string | null;
  adjusted_amount: number | null;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  draft:      { text: '발행 전', cls: 'bg-slate-600 text-slate-100' },
  sent:       { text: '회신 대기', cls: 'bg-amber-500/20 text-amber-300' },
  replied:    { text: '회신 완료', cls: 'bg-blue-500/20 text-blue-300' },
  reconciled: { text: '대사 완료', cls: 'bg-emerald-500/20 text-emerald-300' },
  completed:  { text: '입금 확인', cls: 'bg-emerald-600 text-white' },
  cancelled:  { text: '취소', cls: 'bg-red-500/20 text-red-300' },
};

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'sent', label: '회신 대기' },
  { key: 'replied', label: '회신 완료' },
  { key: 'completed', label: '입금 확인' },
];

interface Props {
  onClose?: () => void;     // 토글 모드(회수관리 내부)에서만 닫기 버튼 노출
  onChanged?: () => void;   // 입금 반영 후 외부 데이터 새로고침
}

export const SettlementRequestList: React.FC<Props> = ({ onClose, onChanged }) => {
  const [requests, setRequests] = useState<SettlementRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SettlementRequest | null>(null);
  const [selectedItems, setSelectedItems] = useState<SettlementItem[]>([]);
  const [selectedDispatches, setSelectedDispatches] = useState<any[]>([]);
  const [selectedPayments, setSelectedPayments] = useState<any[]>([]);
  const [paymentModal, setPaymentModal] = useState<SettlementRequest | null>(null);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase.from('settlement_requests') as any)
        .select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      setRequests((data || []) as SettlementRequest[]);
    } catch (e: any) {
      alert('목록 로드 실패: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (search) {
        const k = search.toLowerCase();
        const match = (r.request_number || '').toLowerCase().includes(k)
          || (r.distributor_name || '').toLowerCase().includes(k);
        if (!match) return false;
      }
      return true;
    });
  }, [requests, statusFilter, search]);

  const openDetail = async (r: SettlementRequest) => {
    if (!supabase) return;
    setSelected(r);
    const [itemsRes, dispRes, payRes] = await Promise.all([
      (supabase.from('settlement_request_items') as any)
        .select('*').eq('request_id', r.id).order('contract_number', { ascending: true }),
      (supabase.from('settlement_request_dispatches') as any)
        .select('*').eq('request_id', r.id).order('sent_at', { ascending: true }),
      (supabase.from('settlement_request_payments') as any)
        .select('*').eq('request_id', r.id).order('applied_at', { ascending: true }),
    ]);
    setSelectedItems((itemsRes.data || []) as SettlementItem[]);
    setSelectedDispatches(dispRes.data || []);
    setSelectedPayments(payRes.data || []);
  };

  const closeDetail = () => { setSelected(null); setSelectedItems([]); setSelectedDispatches([]); setSelectedPayments([]); };

  const copyTokenUrl = (r: SettlementRequest) => {
    const url = `${window.location.origin}${window.location.pathname}?settle_token=${r.token}`;
    navigator.clipboard.writeText(url).then(() => alert('청구서 URL이 클립보드에 복사되었습니다.'));
  };

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-5 space-y-4">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <h3 className="text-white font-semibold text-lg">정산요청서 관리</h3>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="text-xs text-slate-400 hover:text-white">↻ 새로고침</button>
          {onClose && (
            <button onClick={onClose}
              className="text-slate-400 hover:text-white text-xl leading-none">×</button>
          )}
        </div>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-slate-900 rounded-lg p-1 gap-1">
          {STATUS_TABS.map(t => (
            <button key={t.key} onClick={() => setStatusFilter(t.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                statusFilter === t.key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}>
              {t.label} ({t.key === 'all' ? requests.length : requests.filter(r => r.status === t.key).length})
            </button>
          ))}
        </div>
        <input type="text" placeholder="청구번호/총판명 검색..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 flex-1 max-w-xs" />
      </div>

      {/* 리스트 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="text-left p-2 font-medium">청구번호</th>
              <th className="text-left p-2 font-medium">총판</th>
              <th className="text-left p-2 font-medium">기간</th>
              <th className="text-right p-2 font-medium">청구액</th>
              <th className="text-right p-2 font-medium">조정액</th>
              <th className="text-right p-2 font-medium">입금액</th>
              <th className="text-center p-2 font-medium">상태</th>
              <th className="text-center p-2 font-medium">액션</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center text-slate-500 py-6">로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-slate-500 py-6">청구서가 없습니다</td></tr>
            ) : filtered.map(r => {
              const si = STATUS_LABEL[r.status] || { text: r.status, cls: 'bg-slate-600 text-slate-100' };
              return (
                <tr key={r.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="p-2 font-mono text-xs text-indigo-300 cursor-pointer" onClick={() => openDetail(r)}>
                    {r.request_number}
                  </td>
                  <td className="p-2 text-white">{r.distributor_name}</td>
                  <td className="p-2 text-slate-300 text-xs">{r.period_from} ~ {r.period_to}</td>
                  <td className="p-2 text-right text-slate-300">₩{formatCurrency(r.billing_amount)}</td>
                  <td className="p-2 text-right text-slate-300">
                    {r.adjusted_amount != null ? `₩${formatCurrency(r.adjusted_amount)}` : '-'}
                  </td>
                  <td className="p-2 text-right text-emerald-400">
                    {r.paid_amount != null ? `₩${formatCurrency(r.paid_amount)}` : '-'}
                  </td>
                  <td className="p-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${si.cls}`}>{si.text}</span>
                  </td>
                  <td className="p-2 text-center text-xs">
                    <div className="flex justify-center gap-1.5">
                      <button onClick={() => copyTokenUrl(r)} className="text-indigo-400 hover:text-indigo-300" title="청구서 URL 복사">🔗</button>
                      <button onClick={() => openDetail(r)} className="text-slate-300 hover:text-white">상세</button>
                      {(r.status === 'sent' || r.status === 'replied') && (
                        <button onClick={() => setPaymentModal(r)} className="text-emerald-400 hover:text-emerald-300">입금확인</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 상세 모달 */}
      {selected && (
        <DetailModal request={selected} items={selectedItems}
          dispatches={selectedDispatches} payments={selectedPayments}
          onClose={closeDetail}
          onOpenPayment={() => { setPaymentModal(selected); closeDetail(); }} />
      )}

      {/* 입금 확인 모달 */}
      {paymentModal && (
        <PaymentModal request={paymentModal}
          onClose={() => setPaymentModal(null)}
          onApplied={() => {
            setPaymentModal(null);
            load();
            onChanged?.();
          }} />
      )}
    </div>
  );
};

// ─── 상세 모달 ───
const DetailModal: React.FC<{
  request: SettlementRequest;
  items: SettlementItem[];
  dispatches: any[];
  payments: any[];
  onClose: () => void;
  onOpenPayment: () => void;
}> = ({ request, items, dispatches, payments, onClose, onOpenPayment }) => {
  const si = STATUS_LABEL[request.status] || { text: request.status, cls: 'bg-slate-600 text-slate-100' };
  const canPay = request.status === 'sent' || request.status === 'replied';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[680px] max-w-[95vw] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-white font-semibold text-lg">정산요청서 상세</h3>
            <p className="font-mono text-xs text-indigo-300 mt-1">{request.request_number}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${si.cls}`}>{si.text}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <Info label="총판" value={request.distributor_name} />
          <Info label="연락처" value={request.distributor_contact || '-'} />
          <Info label="청구 기간" value={`${request.period_from} ~ ${request.period_to}`} />
          <Info label="발송 일시" value={request.sent_at ? new Date(request.sent_at).toLocaleString('ko-KR') : '-'} />
          <Info label="회신 일시" value={request.replied_at ? new Date(request.replied_at).toLocaleString('ko-KR') : '-'} />
          <Info label="입금 확인 일시" value={request.completed_at ? new Date(request.completed_at).toLocaleString('ko-KR') : '-'} />
        </div>

        <div className="grid grid-cols-3 gap-3 text-sm mb-4 bg-slate-900/50 rounded p-3">
          <div>
            <div className="text-xs text-slate-400">원래 청구액</div>
            <div className="text-white font-semibold mt-1">₩{formatCurrency(request.billing_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">회신 조정액</div>
            <div className="text-white font-semibold mt-1">
              {request.adjusted_amount != null ? `₩${formatCurrency(request.adjusted_amount)}` : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">실제 입금액</div>
            <div className="text-emerald-400 font-semibold mt-1">
              {request.paid_amount != null ? `₩${formatCurrency(request.paid_amount)}` : '-'}
            </div>
          </div>
        </div>

        {request.reply_memo && (
          <div className="mb-4">
            <div className="text-xs text-slate-400 mb-1">총판 회신 메모</div>
            <div className="text-sm text-slate-200 bg-slate-900/50 rounded p-2 whitespace-pre-wrap">{request.reply_memo}</div>
          </div>
        )}

        <h4 className="text-white font-medium text-sm mb-2">청구 항목 ({items.length}건)</h4>
        <div className="space-y-1.5 mb-4">
          {items.map(it => (
            <div key={it.id} className={`bg-slate-900/50 rounded p-2 border ${it.excluded ? 'border-orange-500/30 opacity-70' : 'border-slate-700'}`}>
              <div className="flex justify-between items-start text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs text-slate-400 mr-2">#{it.contract_number}</span>
                  <span className="text-white">{it.lessee_name}</span>
                  <span className="text-xs text-slate-400 ml-2">{it.device_name}</span>
                  {it.excluded && (
                    <div className="text-xs text-orange-300 mt-1">
                      ⊘ 제외 {it.excluded_reason && `· ${it.excluded_reason}`}
                    </div>
                  )}
                </div>
                <div className={`text-right whitespace-nowrap font-semibold ${it.excluded ? 'text-slate-500 line-through' : 'text-emerald-400'}`}>
                  ₩{formatCurrency(it.period_amount)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 발송 이력 */}
        <h4 className="text-white font-medium text-sm mb-2 mt-4">발송 이력 ({dispatches.length}건)</h4>
        <div className="space-y-1.5 mb-4">
          {dispatches.length === 0 ? (
            <div className="text-xs text-slate-500">발송 기록 없음</div>
          ) : dispatches.map((d, i) => (
            <div key={i} className="bg-slate-900/50 rounded p-2 border border-slate-700 text-xs">
              <div className="flex justify-between items-center">
                <div>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] mr-2 ${d.channel === 'sms' ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-600 text-slate-200'}`}>
                    {d.channel === 'sms' ? 'SMS' : '수동복사'}
                  </span>
                  {d.target_contact && <span className="text-slate-300">{d.target_contact}</span>}
                  <span className={`ml-2 text-[10px] ${d.status === 'sent' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {d.status === 'sent' ? '✓ 발송' : '✗ 실패'}
                  </span>
                </div>
                <span className="text-slate-400">{d.sent_at ? new Date(d.sent_at).toLocaleString('ko-KR') : '-'}</span>
              </div>
              {d.error && <div className="text-red-300 mt-1">{d.error}</div>}
            </div>
          ))}
        </div>

        {/* 입금 분배 이력 */}
        {payments.length > 0 && (
          <>
            <h4 className="text-white font-medium text-sm mb-2">입금 분배 이력 ({payments.length}건)</h4>
            <div className="space-y-2 mb-4">
              {payments.map((p, i) => {
                const dist = Array.isArray(p.distribution) ? p.distribution : [];
                return (
                  <div key={i} className="bg-slate-900/50 rounded p-3 border border-slate-700 text-xs">
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <span className="text-emerald-400 font-semibold">₩{formatCurrency(p.paid_amount)}</span>
                        <span className="text-slate-400 ml-2">{p.paid_date || '-'}</span>
                        {p.bank_memo && <span className="text-slate-400 ml-2">· {p.bank_memo}</span>}
                      </div>
                      <span className="text-slate-400">{p.applied_at ? new Date(p.applied_at).toLocaleString('ko-KR') : '-'}</span>
                    </div>
                    <div className="text-slate-400 mb-1">분배 내역 ({dist.length}건)</div>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {dist.map((d: any, j: number) => (
                        <div key={j} className="flex justify-between text-slate-300">
                          <span>{d.deduction_date}</span>
                          <span className="text-emerald-400">₩{formatCurrency(d.applied_amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {request.admin_memo && (
          <div className="mb-4 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded p-2">
            ℹ {request.admin_memo}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200">닫기</button>
          {canPay && (
            <button onClick={onOpenPayment} className="text-sm px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white">
              입금 확인 처리
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Info: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-xs text-slate-400">{label}</div>
    <div className="text-slate-200 mt-0.5">{value}</div>
  </div>
);

// ─── 입금 확인 모달 ───
const PaymentModal: React.FC<{
  request: SettlementRequest;
  onClose: () => void;
  onApplied: () => void;
}> = ({ request, onClose, onApplied }) => {
  const [paidAmount, setPaidAmount] = useState<string>(
    String(request.adjusted_amount ?? request.billing_amount ?? '')
  );
  const [paidDate, setPaidDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [bankMemo, setBankMemo] = useState<string>('');
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<{
    unpaidTotal: number;
    distribution: { contract_id: string; contract_number: number; date: string; applied: number }[];
    leftover: number;   // 미분배 (이월)
    overflow: number;   // 초과 입금
  } | null>(null);

  const expected = request.adjusted_amount ?? request.billing_amount ?? 0;
  const paid = Number(paidAmount) || 0;
  const diff = paid - expected;

  // 미리보기 계산
  const previewDistribution = async () => {
    if (!supabase) return;
    if (!paid || paid <= 0) { alert('입금액을 입력하세요.'); return; }
    try {
      // 제외 안 한 항목들
      const { data: items } = await (supabase.from('settlement_request_items') as any)
        .select('*').eq('request_id', request.id).eq('excluded', false);
      const itemList = (items || []) as SettlementItem[];
      const contractIds = itemList.map(i => i.contract_id);
      if (contractIds.length === 0) { alert('분배할 항목이 없습니다.'); return; }

      const { data: contracts } = await (supabase.from('contracts') as any)
        .select('id, contract_number, daily_deductions').in('id', contractIds);

      // 분배 대상 entry 모으기
      type Entry = { contract_id: string; contract_number: number; deduction_id: string; date: string; unpaid: number };
      const entries: Entry[] = [];
      for (const c of (contracts || []) as any[]) {
        for (const dd of (c.daily_deductions || [])) {
          if (!dd?.date) continue;
          if (dd.date < request.period_from || dd.date > request.period_to) continue;
          const amount = Number(dd.amount) || 0;
          const paidDd = Number(dd.paid_amount) || 0;
          if (amount <= paidDd) continue;
          entries.push({
            contract_id: c.id,
            contract_number: c.contract_number,
            deduction_id: dd.id,
            date: dd.date,
            unpaid: amount - paidDd,
          });
        }
      }
      // 오래된 순 정렬
      entries.sort((a, b) => a.date.localeCompare(b.date) || a.contract_number - b.contract_number);
      const unpaidTotal = entries.reduce((s, e) => s + e.unpaid, 0);

      let remaining = paid;
      const dist: { contract_id: string; contract_number: number; date: string; applied: number }[] = [];
      for (const e of entries) {
        if (remaining <= 0) break;
        const applied = Math.min(remaining, e.unpaid);
        dist.push({ contract_id: e.contract_id, contract_number: e.contract_number, date: e.date, applied });
        remaining -= applied;
      }
      setPreview({
        unpaidTotal,
        distribution: dist,
        leftover: Math.max(0, unpaidTotal - paid),
        overflow: remaining,  // > 0이면 초과 입금
      });
    } catch (e: any) {
      alert('미리보기 실패: ' + e.message);
    }
  };

  const applyPayment = async () => {
    if (!supabase || applying) return;
    if (!paid || paid <= 0) { alert('입금액을 입력하세요.'); return; }
    if (!preview) { alert('먼저 미리보기를 실행하세요.'); return; }
    if (!confirm(`₩${formatCurrency(paid)} 입금 확인 처리하고 daily_deductions에 분배합니다. 계속할까요?`)) return;

    setApplying(true);
    try {
      // 1. 최신 contracts 데이터 fresh fetch (race condition 방지)
      const { data: items } = await (supabase.from('settlement_request_items') as any)
        .select('contract_id').eq('request_id', request.id).eq('excluded', false);
      const contractIds = Array.from(new Set(((items || []) as any[]).map(i => i.contract_id)));
      const { data: contracts } = await (supabase.from('contracts') as any)
        .select('id, daily_deductions').in('id', contractIds);

      type Entry = { contract_id: string; deduction_id: string; date: string; unpaid: number; before_paid: number; amount: number };
      const entries: Entry[] = [];
      const contractMap = new Map<string, any>();
      for (const c of (contracts || []) as any[]) {
        contractMap.set(c.id, c);
        for (const dd of (c.daily_deductions || [])) {
          if (!dd?.date) continue;
          if (dd.date < request.period_from || dd.date > request.period_to) continue;
          const amount = Number(dd.amount) || 0;
          const paidDd = Number(dd.paid_amount) || 0;
          if (amount <= paidDd) continue;
          entries.push({
            contract_id: c.id,
            deduction_id: dd.id,
            date: dd.date,
            unpaid: amount - paidDd,
            before_paid: paidDd,
            amount,
          });
        }
      }
      entries.sort((a, b) => a.date.localeCompare(b.date) || a.contract_id.localeCompare(b.contract_id));

      let remaining = paid;
      const distribution: any[] = [];
      const perContract = new Map<string, { deduction_id: string; new_paid: number; new_status: string }[]>();
      for (const e of entries) {
        if (remaining <= 0) break;
        const applied = Math.min(remaining, e.unpaid);
        const newPaid = e.before_paid + applied;
        const newStatus = newPaid >= e.amount ? '납부완료' : '부분납부';
        distribution.push({
          contract_id: e.contract_id,
          deduction_id: e.deduction_id,
          deduction_date: e.date,
          applied_amount: applied,
          before_paid: e.before_paid,
        });
        const list = perContract.get(e.contract_id) || [];
        list.push({ deduction_id: e.deduction_id, new_paid: newPaid, new_status: newStatus });
        perContract.set(e.contract_id, list);
        remaining -= applied;
      }

      // 2. 각 계약의 daily_deductions 업데이트
      for (const [contractId, updates] of perContract.entries()) {
        const contract = contractMap.get(contractId);
        if (!contract) continue;
        const newDDs = (contract.daily_deductions || []).map((dd: any) => {
          const u = updates.find(x => x.deduction_id === dd.id);
          if (!u) return dd;
          return { ...dd, paid_amount: u.new_paid, status: u.new_status };
        });
        const { error: updErr } = await (supabase.from('contracts') as any)
          .update({ daily_deductions: newDDs }).eq('id', contractId);
        if (updErr) throw updErr;
      }

      // 3. settlement_request_payments INSERT (분배 백업)
      const { error: payErr } = await (supabase.from('settlement_request_payments') as any).insert({
        request_id: request.id,
        paid_amount: paid,
        paid_date: paidDate,
        bank_memo: bankMemo || null,
        distribution: distribution,
      });
      if (payErr) throw payErr;

      // 4. settlement_request UPDATE → completed
      const overflow = remaining > 0;
      const adminMemo = overflow
        ? `초과 입금 ₩${formatCurrency(remaining)} 발생 (별도 처리 필요)`
        : (paid < (request.adjusted_amount ?? request.billing_amount) ? `차액 ₩${formatCurrency((request.adjusted_amount ?? request.billing_amount) - paid)}은 미납으로 이월` : null);
      const { error: srErr } = await (supabase.from('settlement_requests') as any)
        .update({
          paid_amount: paid,
          status: 'completed',
          completed_at: new Date().toISOString(),
          admin_memo: adminMemo,
        }).eq('id', request.id);
      if (srErr) throw srErr;

      alert('입금 확인 처리 완료');
      onApplied();
    } catch (e: any) {
      console.error(e);
      alert('처리 실패: ' + (e.message || e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={() => !applying && onClose()}>
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[640px] max-w-[95vw] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-white font-semibold text-lg">입금 확인 처리</h3>
            <p className="font-mono text-xs text-indigo-300 mt-1">{request.request_number} · {request.distributor_name}</p>
          </div>
          <button onClick={onClose} disabled={applying} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* 3자 비교 */}
        <div className="grid grid-cols-3 gap-3 text-sm mb-4 bg-slate-900/50 rounded p-3">
          <div>
            <div className="text-xs text-slate-400">원래 청구액</div>
            <div className="text-white font-semibold mt-1">₩{formatCurrency(request.billing_amount)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">회신 조정액 ②</div>
            <div className="text-white font-semibold mt-1">
              {request.adjusted_amount != null ? `₩${formatCurrency(request.adjusted_amount)}` : '회신 전'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">실제 입금액 ③</div>
            <div className="text-emerald-400 font-semibold mt-1">₩{formatCurrency(paid)}</div>
          </div>
        </div>

        {/* 차이 알림 */}
        {paid > 0 && diff !== 0 && (
          <div className={`text-xs rounded p-2 mb-3 ${diff < 0 ? 'bg-orange-500/10 text-orange-300 border border-orange-500/30' : 'bg-amber-500/10 text-amber-300 border border-amber-500/30'}`}>
            {diff < 0
              ? `⚠ 부족 ₩${formatCurrency(-diff)} — 차액은 미납으로 이월되어 다음 청구서에 자동 포함됩니다.`
              : `⚠ 초과 ₩${formatCurrency(diff)} — 분배할 미납을 초과한 부분은 청구서 메모에 기록되고, 어드민이 별도 확인해야 합니다.`}
          </div>
        )}

        {/* 입력 */}
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-20">입금액 ③</label>
            <input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white flex-1" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-20">입금일자</label>
            <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 w-20">통장 메모</label>
            <input type="text" placeholder="입금자명 등" value={bankMemo} onChange={e => setBankMemo(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white flex-1" />
          </div>
        </div>

        {/* 미리보기 */}
        <div className="bg-slate-900/50 rounded p-3 mb-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-white text-sm font-medium">분배 미리보기</h4>
            <button onClick={previewDistribution} disabled={applying}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded">미리보기 실행</button>
          </div>
          {preview ? (
            <>
              <p className="text-xs text-slate-400 mb-2">
                기간 내 미납 총 ₩{formatCurrency(preview.unpaidTotal)} · 입금액 ₩{formatCurrency(paid)} 분배
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1 mb-2">
                {preview.distribution.length === 0 ? (
                  <div className="text-xs text-slate-500">분배 결과 없음</div>
                ) : preview.distribution.map((d, i) => (
                  <div key={i} className="text-xs flex justify-between text-slate-300">
                    <span>{d.date} · #{d.contract_number}</span>
                    <span className="text-emerald-400">₩{formatCurrency(d.applied)}</span>
                  </div>
                ))}
              </div>
              {preview.leftover > 0 && (
                <p className="text-xs text-orange-300">
                  미분배 ₩{formatCurrency(preview.leftover)} (미납으로 남음)
                </p>
              )}
              {preview.overflow > 0 && (
                <p className="text-xs text-amber-300">
                  초과 ₩{formatCurrency(preview.overflow)} (분배할 미납을 넘어선 금액)
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">미리보기 실행 후 분배 내역을 확인할 수 있습니다.</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={applying}
            className="text-sm px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50">취소</button>
          <button onClick={applyPayment} disabled={applying || !preview}
            className="text-sm px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
            {applying ? '처리 중...' : '입금 확인 · 납부액 반영'}
          </button>
        </div>
      </div>
    </div>
  );
};
