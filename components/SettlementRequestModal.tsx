import React, { useMemo, useState } from 'react';
import { Contract } from '../types';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/utils';
import { sendSmsApi } from './AutomationCenter';

interface Props {
  open: boolean;
  contracts: Contract[];        // 선택된 계약들 (체크박스로 고른)
  onClose: () => void;
  onPublished?: () => void;     // 발행 완료 콜백
}

interface DistributorGroup {
  partner_id: string | null;
  distributor_name: string;
  distributor_contact: string | null;
  contracts: Contract[];
  // 청구액 = 각 계약의 from~to 기간 미납액 합계
  contract_amounts: Map<string, number>;
  total: number;
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

// 기간 내 미납액 합산
function computePeriodUnpaid(contract: Contract, from: string, to: string): number {
  const dds = contract.daily_deductions || [];
  let sum = 0;
  for (const d of dds) {
    if (!d || !d.date) continue;
    if (d.date < from || d.date > to) continue;
    const amt = Number(d.amount) || 0;
    const paid = Number(d.paid_amount) || 0;
    if (amt > paid) sum += (amt - paid);
  }
  return sum;
}

function buildSmsBody(args: {
  distributor_name: string;
  request_number: string;
  period_from: string;
  period_to: string;
  billing_amount: number;
  url: string;
}): string {
  return `[비엘큐] 정산요청서 도착\n` +
    `${args.distributor_name} 귀하\n` +
    `청구번호: ${args.request_number}\n` +
    `기간: ${args.period_from} ~ ${args.period_to}\n` +
    `청구액: ₩${formatCurrency(args.billing_amount)}\n\n` +
    `확인/회신: ${args.url}`;
}

function randomToken(): string {
  // 안전한 URL-safe 랜덤 토큰 (32 chars)
  const bytes = new Uint8Array(24);
  (globalThis.crypto || (window as any).crypto).getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const SettlementRequestModal: React.FC<Props> = ({ open, contracts, onClose, onPublished }) => {
  const [range, setRange] = useState(defaultRange);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<string>('');

  // 총판별 그룹핑 + 청구액 계산
  const groups = useMemo<DistributorGroup[]>(() => {
    const map = new Map<string, DistributorGroup>();
    for (const c of contracts) {
      const key = c.partner_id || `__noname__${c.distributor_name || ''}`;
      let g = map.get(key);
      if (!g) {
        g = {
          partner_id: c.partner_id || null,
          distributor_name: c.distributor_name || '(총판명 없음)',
          distributor_contact: c.distributor_contact || null,
          contracts: [],
          contract_amounts: new Map(),
          total: 0,
        };
        map.set(key, g);
      }
      const amount = computePeriodUnpaid(c, range.from, range.to);
      g.contracts.push(c);
      g.contract_amounts.set(c.id, amount);
      g.total += amount;
    }
    return Array.from(map.values())
      .filter(g => g.total > 0)  // 청구액 0원인 총판은 제외
      .sort((a, b) => b.total - a.total);
  }, [contracts, range.from, range.to]);

  const totalAmount = groups.reduce((s, g) => s + g.total, 0);
  const groupsWithoutContact = groups.filter(g => !g.distributor_contact).length;

  const handlePublish = async () => {
    if (publishing || !supabase) return;
    if (!range.from || !range.to || range.from > range.to) { alert('기간을 확인하세요.'); return; }
    if (groups.length === 0) { alert('청구할 계약이 없습니다 (기간 내 미납 0).'); return; }

    const confirmMsg = `${groups.length}개 총판에게 정산요청서 발행\n` +
      `총 청구액: ₩${formatCurrency(totalAmount)}\n` +
      (groupsWithoutContact > 0 ? `⚠ ${groupsWithoutContact}건은 연락처 없어서 SMS 미발송 (토큰 URL은 생성됨)\n` : '') +
      `\n진행할까요?`;
    if (!confirm(confirmMsg)) return;

    setPublishing(true);
    let okCount = 0, failCount = 0, smsOk = 0, smsFail = 0;
    const baseUrl = `${window.location.origin}${window.location.pathname}`;

    try {
      for (const [idx, g] of groups.entries()) {
        setProgress(`(${idx + 1}/${groups.length}) ${g.distributor_name} 처리 중...`);

        // 청구번호 생성
        const { data: numData, error: numErr } = await (supabase.rpc as any)('generate_settlement_request_number', {});
        if (numErr || !numData) { failCount++; continue; }
        const requestNumber = numData as string;
        const token = randomToken();

        // 청구서 INSERT
        const { data: reqInserted, error: reqErr } = await (supabase.from('settlement_requests') as any)
          .insert({
            request_number: requestNumber,
            distributor_partner_id: g.partner_id,
            distributor_name: g.distributor_name,
            distributor_contact: g.distributor_contact,
            period_from: range.from,
            period_to: range.to,
            billing_amount: g.total,
            status: 'draft',
            token,
          })
          .select('id')
          .single();
        if (reqErr || !reqInserted) {
          console.error('청구서 INSERT 실패:', reqErr);
          failCount++;
          continue;
        }
        const requestId = (reqInserted as any).id as string;

        // 항목 INSERT
        const items = g.contracts.map(c => ({
          request_id: requestId,
          contract_id: c.id,
          contract_number: c.contract_number,
          lessee_name: c.lessee_name,
          device_name: c.device_name,
          period_amount: g.contract_amounts.get(c.id) || 0,
        })).filter(it => Number(it.period_amount) > 0);

        if (items.length > 0) {
          const { error: itemsErr } = await (supabase.from('settlement_request_items') as any).insert(items);
          if (itemsErr) console.error('항목 INSERT 실패:', itemsErr);
        }

        // SMS 발송 (연락처 있는 경우만)
        const url = `${baseUrl}?settle_token=${token}`;
        let dispatchChannel: 'sms' | 'manual' = 'manual';
        let dispatchStatus: 'sent' | 'failed' = 'sent';
        let dispatchError: string | null = null;
        let smsBody = buildSmsBody({
          distributor_name: g.distributor_name,
          request_number: requestNumber,
          period_from: range.from,
          period_to: range.to,
          billing_amount: g.total,
          url,
        });

        if (g.distributor_contact) {
          dispatchChannel = 'sms';
          const r = await sendSmsApi(g.distributor_contact, smsBody);
          if (r.ok) { smsOk++; } else { dispatchStatus = 'failed'; dispatchError = r.error; smsFail++; }
        }

        await (supabase.from('settlement_request_dispatches') as any).insert({
          request_id: requestId,
          channel: dispatchChannel,
          target_contact: g.distributor_contact,
          body: smsBody,
          status: dispatchStatus,
          error: dispatchError,
        });

        // status를 sent로 업데이트 (manual이어도 발행은 완료된 것으로 간주)
        await (supabase.from('settlement_requests') as any)
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', requestId);

        okCount++;
      }

      setProgress('완료');
      alert(`정산요청서 발행 완료\n` +
        `성공: ${okCount}건 / 실패: ${failCount}건\n` +
        `SMS: ${smsOk}건 성공 / ${smsFail}건 실패 / ${groupsWithoutContact}건 미발송`);
      onPublished?.();
      onClose();
    } catch (e) {
      console.error(e);
      alert('발행 중 오류: ' + (e as Error).message);
    } finally {
      setPublishing(false);
      setProgress('');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !publishing && onClose()}>
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-[720px] max-w-[95vw] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-white font-semibold text-lg">정산요청서 발행</h3>
            <p className="text-xs text-slate-400 mt-1">선택된 계약 {contracts.length}건을 총판별로 자동 그룹핑하여 발행합니다</p>
          </div>
          <button onClick={onClose} disabled={publishing} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* 정산기간 */}
        <div className="bg-slate-900/50 rounded-lg p-4 mb-4">
          <label className="text-xs text-slate-400 block mb-2">정산기간</label>
          <div className="flex items-center gap-2">
            <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
            <span className="text-slate-400">~</span>
            <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
              className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white" />
          </div>
        </div>

        {/* 총판별 그룹 미리보기 */}
        <div className="space-y-2 mb-4">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-medium text-slate-300">총판별 청구서 ({groups.length}건)</h4>
            <span className="text-xs text-slate-400">총 ₩{formatCurrency(totalAmount)}</span>
          </div>
          {groups.length === 0 ? (
            <div className="text-center text-slate-500 py-6 text-sm">기간 내 미납이 있는 계약이 없습니다.</div>
          ) : (
            groups.map(g => (
              <div key={g.partner_id || g.distributor_name} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-white font-medium">{g.distributor_name}</span>
                    <span className="text-xs text-slate-400 ml-2">({g.contracts.length}계약)</span>
                    {g.distributor_contact ? (
                      <span className="text-xs text-slate-500 ml-2">· {g.distributor_contact}</span>
                    ) : (
                      <span className="text-xs text-orange-400 ml-2">· ⚠ 연락처 없음 (SMS 미발송, URL만 생성)</span>
                    )}
                  </div>
                  <span className="text-sm font-semibold text-emerald-400">₩{formatCurrency(g.total)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.contracts.map(c => {
                    const amt = g.contract_amounts.get(c.id) || 0;
                    return (
                      <span key={c.id} className={`text-[10px] px-1.5 py-0.5 rounded ${amt > 0 ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-600 line-through'}`}>
                        #{c.contract_number} {c.lessee_name} ₩{formatCurrency(amt)}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 진행 상태 */}
        {publishing && (
          <div className="text-xs text-indigo-400 mb-3">{progress}</div>
        )}

        {/* 액션 */}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={publishing}
            className="text-sm px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50">
            취소
          </button>
          <button onClick={handlePublish} disabled={publishing || groups.length === 0}
            className="text-sm px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
            {publishing ? '발행 중...' : `발행 및 발송 (${groups.length}건)`}
          </button>
        </div>
      </div>
    </div>
  );
};
