import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { formatCurrency } from '../lib/utils';
import { InfoTooltip } from './InfoTooltip';

// ===== 타입 =====
interface CreditAgency { name: string; email: string; }
interface AutomationSettings {
  sms_auto_enabled: boolean;
  sms_template: string;
  sms_max_count: number;
  sms_cooldown_days: number;
  credit_agencies: CreditAgency[];
}
interface SmsTarget {
  contract_id: string;
  contract_number: number;
  lessee_name: string;
  lessee_contact: string | null;
  distributor_name: string;
  distributor_contact: string | null;
  overdue_days: number;
  total_unpaid: number;
  past_send_count: number;
  last_sent_at: string | null;
}
interface AgencyTarget {
  contract_id: string;
  contract_number: number;
  lessee_name: string;
  lessee_contact: string | null;
  lessee_business_number: string | null;
  distributor_name: string;
  overdue_days: number;
  total_unpaid: number;
  already_sent: boolean;
  last_sent_agency: string | null;
  last_sent_at: string | null;
}
interface DispatchLog {
  id: string;
  contract_id: string;
  action_type: string;
  target_address: string;
  target_name: string;
  agency_name: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  created_at: string;
  sent_at: string | null;
  error: string | null;
  is_mock: boolean;
}

// ===== 발송 stub (나중에 실제 API로 교체) =====
async function sendSmsStub(_target: string, _body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // TODO: 실제 SMS 게이트웨이 연동 (Aligo, NHN Cloud 등)
  await new Promise(r => setTimeout(r, 200));
  return { ok: true };
}
async function sendEmailStub(_to: string, _subject: string, _body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // TODO: 실제 메일 API 연동 (Supabase Edge Function + Resend 등)
  await new Promise(r => setTimeout(r, 300));
  return { ok: true };
}

// ===== 템플릿 변환 =====
function renderTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? `{${k}}`);
}

export const AutomationCenter: React.FC<{ anchorDate?: string }> = ({ anchorDate }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'sms' | 'agency' | 'history' | 'settings'>('sms');
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [smsTargets, setSmsTargets] = useState<SmsTarget[]>([]);
  const [agencyTargets, setAgencyTargets] = useState<AgencyTarget[]>([]);
  const [history, setHistory] = useState<DispatchLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [smsSelected, setSmsSelected] = useState<Set<string>>(new Set());
  const [agencySelected, setAgencySelected] = useState<Set<string>>(new Set());
  const [agencyChoice, setAgencyChoice] = useState<number>(0); // 0 or 1 (둘 중 하나)
  const [previewing, setPreviewing] = useState<{ type: 'sms'|'agency'; contractId: string } | null>(null);
  const [sending, setSending] = useState(false);

  // 데이터 로드
  const loadAll = useCallback(async () => {
    if (!supabase || !open) return;
    setLoading(true);
    try {
      const [settingsRes, smsRes, agencyRes, histRes] = await Promise.all([
        (supabase.from('automation_settings') as any).select('*').eq('id', 'global').single(),
        (supabase.rpc as any)('get_pending_sms_targets', anchorDate ? { anchor_date: anchorDate } : {}),
        (supabase.rpc as any)('get_pending_credit_agency_targets', anchorDate ? { anchor_date: anchorDate } : {}),
        (supabase.from('automation_dispatch_log') as any)
          .select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      if (settingsRes.data) {
        const d = settingsRes.data;
        setSettings({
          sms_auto_enabled: !!d.sms_auto_enabled,
          sms_template: d.sms_template || '',
          sms_max_count: Number(d.sms_max_count) || 3,
          sms_cooldown_days: Number(d.sms_cooldown_days) || 7,
          credit_agencies: Array.isArray(d.credit_agencies) ? d.credit_agencies : [{name:'',email:''},{name:'',email:''}],
        });
      }
      setSmsTargets(((smsRes.data || []) as any[]).map((r: any) => ({
        contract_id: r.contract_id,
        contract_number: Number(r.contract_number) || 0,
        lessee_name: r.lessee_name || '',
        lessee_contact: r.lessee_contact,
        distributor_name: r.distributor_name || '',
        distributor_contact: r.distributor_contact,
        overdue_days: Number(r.overdue_days) || 0,
        total_unpaid: Number(r.total_unpaid) || 0,
        past_send_count: Number(r.past_send_count) || 0,
        last_sent_at: r.last_sent_at,
      })));
      setAgencyTargets(((agencyRes.data || []) as any[]).map((r: any) => ({
        contract_id: r.contract_id,
        contract_number: Number(r.contract_number) || 0,
        lessee_name: r.lessee_name || '',
        lessee_contact: r.lessee_contact,
        lessee_business_number: r.lessee_business_number,
        distributor_name: r.distributor_name || '',
        overdue_days: Number(r.overdue_days) || 0,
        total_unpaid: Number(r.total_unpaid) || 0,
        already_sent: !!r.already_sent,
        last_sent_agency: r.last_sent_agency,
        last_sent_at: r.last_sent_at,
      })));
      setHistory((histRes.data || []) as DispatchLog[]);
    } catch (e: any) {
      console.error(e);
      alert(`자동조치 데이터 로드 실패: ${e.message}\n\n(테이블/RPC가 DB에 없을 수 있어요. sql_automation_setup.sql 실행 확인)`);
    } finally {
      setLoading(false);
    }
  }, [open, anchorDate]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ===== 설정 저장 =====
  const saveSettings = async () => {
    if (!supabase || !settings) return;
    try {
      await (supabase.from('automation_settings') as any).update({
        sms_auto_enabled: settings.sms_auto_enabled,
        sms_template: settings.sms_template,
        sms_max_count: settings.sms_max_count,
        sms_cooldown_days: settings.sms_cooldown_days,
        credit_agencies: settings.credit_agencies,
        updated_at: new Date().toISOString(),
      }).eq('id', 'global');
      alert('설정 저장 완료');
      loadAll();
    } catch (e: any) {
      alert(`저장 실패: ${e.message}`);
    }
  };

  // ===== SMS 발송 =====
  const sendSms = async (contracts: SmsTarget[]) => {
    if (!supabase || !settings) return;
    if (contracts.length === 0) return;
    if (!confirm(`${contracts.length}개 계약에 SMS 발송 (각 계약당 계약자+총판 2건)\n총 ${contracts.length * 2}건의 메시지가 발송됩니다.\n\n진행할까요?`)) return;

    setSending(true);
    let okCount = 0, failCount = 0;
    for (const c of contracts) {
      const body = renderTemplate(settings.sms_template, {
        name: c.lessee_name,
        days: String(c.overdue_days),
        amount: formatCurrency(c.total_unpaid),
      });
      // 계약자 + 총판 2건
      for (const recipient of [
        { type: 'sms_lessee', name: c.lessee_name, contact: c.lessee_contact },
        { type: 'sms_distributor', name: c.distributor_name, contact: c.distributor_contact },
      ] as const) {
        if (!recipient.contact) {
          await (supabase.from('automation_dispatch_log') as any).insert({
            contract_id: c.contract_id, action_type: recipient.type,
            target_address: '', target_name: recipient.name, body,
            status: 'failed', error: '연락처 없음', is_mock: true,
          });
          failCount++;
          continue;
        }
        const result = await sendSmsStub(recipient.contact, body);
        await (supabase.from('automation_dispatch_log') as any).insert({
          contract_id: c.contract_id, action_type: recipient.type,
          target_address: recipient.contact, target_name: recipient.name, body,
          status: result.ok ? 'sent' : 'failed',
          sent_at: result.ok ? new Date().toISOString() : null,
          error: result.ok ? null : result.error,
          is_mock: true,
        });
        if (result.ok) okCount++; else failCount++;
      }
    }
    setSending(false);
    alert(`발송 완료\n성공: ${okCount}건\n실패: ${failCount}건\n\n(현재 mock 모드 - 실제로는 발송되지 않음)`);
    setSmsSelected(new Set());
    loadAll();
  };

  // ===== 신정사 메일 발송 =====
  const sendAgencyEmail = async (contracts: AgencyTarget[]) => {
    if (!supabase || !settings) return;
    if (contracts.length === 0) return;
    const agency = settings.credit_agencies[agencyChoice];
    if (!agency || !agency.email) {
      alert('선택한 신정사의 이메일이 등록되지 않았어요. 설정에서 등록해주세요.');
      return;
    }
    if (!confirm(`${contracts.length}개 계약을 ${agency.name || '(이름 없음)'}(${agency.email})에 의뢰\n진행할까요?`)) return;

    setSending(true);
    const subject = `[지연 회수 의뢰] ${contracts.length}건 - ${new Date().toLocaleDateString()}`;
    const body = `다음 계약에 대한 지연 회수를 의뢰합니다.\n\n` +
      contracts.map((c, i) => `${i + 1}. ${c.lessee_name} (계약 #${c.contract_number}) · 사업자 ${c.lessee_business_number || '-'} · 총판 ${c.distributor_name} · 연체 ${c.overdue_days}일 · 미수액 ${formatCurrency(c.total_unpaid)}`).join('\n');

    const result = await sendEmailStub(agency.email, subject, body);
    // 각 계약별로 이력 기록
    for (const c of contracts) {
      await (supabase.from('automation_dispatch_log') as any).insert({
        contract_id: c.contract_id,
        action_type: 'credit_agency_email',
        target_address: agency.email,
        target_name: agency.name,
        agency_name: agency.name,
        subject,
        body,
        status: result.ok ? 'sent' : 'failed',
        sent_at: result.ok ? new Date().toISOString() : null,
        error: result.ok ? null : result.error,
        is_mock: true,
      });
    }
    setSending(false);
    alert(result.ok
      ? `${contracts.length}건 의뢰 메일 발송 완료\n(현재 mock 모드 - 실제로는 발송되지 않음)`
      : `발송 실패: ${result.error}`);
    setAgencySelected(new Set());
    loadAll();
  };

  // ===== 미리보기 =====
  const previewContent = useMemo(() => {
    if (!previewing || !settings) return null;
    if (previewing.type === 'sms') {
      const c = smsTargets.find(t => t.contract_id === previewing.contractId);
      if (!c) return null;
      const body = renderTemplate(settings.sms_template, {
        name: c.lessee_name, days: String(c.overdue_days), amount: formatCurrency(c.total_unpaid),
      });
      return {
        title: `SMS 미리보기 — ${c.lessee_name}`,
        items: [
          { label: '수신 1 (계약자)', value: `${c.lessee_name} ${c.lessee_contact || '(연락처 없음)'}`, body },
          { label: '수신 2 (총판)', value: `${c.distributor_name} ${c.distributor_contact || '(연락처 없음)'}`, body },
        ],
      };
    } else {
      const c = agencyTargets.find(t => t.contract_id === previewing.contractId);
      if (!c) return null;
      const agency = settings.credit_agencies[agencyChoice];
      const subject = `[지연 회수 의뢰] ${c.lessee_name} (계약 #${c.contract_number})`;
      const body = `계약자: ${c.lessee_name}\n사업자번호: ${c.lessee_business_number || '-'}\n총판: ${c.distributor_name}\n연체일: ${c.overdue_days}일\n미수액: ${formatCurrency(c.total_unpaid)}`;
      return {
        title: `신정사 메일 미리보기 — ${c.lessee_name}`,
        items: [
          { label: `수신: ${agency?.name || '(미설정)'}`, value: agency?.email || '(이메일 미설정)', body: `제목: ${subject}\n\n${body}` },
        ],
      };
    }
  }, [previewing, settings, smsTargets, agencyTargets, agencyChoice]);

  // 일괄 토글
  const toggleAllSms = () => {
    if (smsSelected.size === smsTargets.length) setSmsSelected(new Set());
    else setSmsSelected(new Set(smsTargets.map(t => t.contract_id)));
  };
  const toggleAllAgency = () => {
    if (agencySelected.size === agencyTargets.length) setAgencySelected(new Set());
    else setAgencySelected(new Set(agencyTargets.map(t => t.contract_id)));
  };

  return (
    <div className="bg-slate-800/60 rounded-xl p-6 border border-slate-700 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            🔔 자동 조치 센터
            <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded font-normal">
              MOCK 모드 - 실제 발송 X
            </span>
            <InfoTooltip text={`8일+ 연체 → 자동 SMS 큐\n21일+ 연체 → 신정사 메일 큐\n\n발송 전 사람이 한 번 검토하고 승인합니다.\n현재는 발송 stub 모드로 이력만 기록됩니다.`} />
          </h3>
          <p className="text-xs text-slate-500 mt-1">발송 큐 검토 → 승인 → 이력 저장. 실제 API는 추후 연결.</p>
        </div>
        <button onClick={() => setOpen(o => !o)}
          className="text-sm bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded">
          {open ? '▲ 닫기' : '▼ 열기'}
        </button>
      </div>

      {open && (loading && !settings ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-indigo-500" />
        </div>
      ) : (
        <>
          {/* 탭 */}
          <div className="flex bg-slate-900/50 rounded-lg p-1 gap-1 w-fit">
            {[
              { key: 'sms', label: `SMS 대기 (${smsTargets.length})` },
              { key: 'agency', label: `신정사 메일 대기 (${agencyTargets.length})` },
              { key: 'history', label: `이력 (${history.length})` },
              { key: 'settings', label: '설정' },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key as any)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  tab === t.key ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* SMS 대기 */}
          {tab === 'sms' && (
            <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="text-xs text-slate-400">
                  8일 이상 연체 · 같은 계약 최대 {settings?.sms_max_count}회 · 최근 발송 {settings?.sms_cooldown_days}일 이내 제외
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={toggleAllSms} className="text-xs text-slate-300 hover:text-white bg-slate-700 px-2 py-1 rounded">
                    {smsSelected.size === smsTargets.length && smsTargets.length > 0 ? '전체 해제' : '전체 선택'}
                  </button>
                  <button onClick={() => sendSms(smsTargets.filter(t => smsSelected.has(t.contract_id)))}
                    disabled={sending || smsSelected.size === 0}
                    className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 rounded">
                    {sending ? '발송 중...' : `선택 ${smsSelected.size}건 발송`}
                  </button>
                </div>
              </div>
              {smsTargets.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-6">발송 대상이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-800 z-10">
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="p-2 text-center w-8"></th>
                        <th className="p-2 text-left">계약자</th>
                        <th className="p-2 text-left">계약자 연락처</th>
                        <th className="p-2 text-left">총판</th>
                        <th className="p-2 text-left">총판 연락처</th>
                        <th className="p-2 text-center">연체</th>
                        <th className="p-2 text-right">미수액</th>
                        <th className="p-2 text-center">발송 횟수</th>
                        <th className="p-2 text-center">미리보기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {smsTargets.map(t => (
                        <tr key={t.contract_id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                          <td className="p-2 text-center">
                            <input type="checkbox" checked={smsSelected.has(t.contract_id)}
                              onChange={() => {
                                const next = new Set(smsSelected);
                                if (next.has(t.contract_id)) next.delete(t.contract_id); else next.add(t.contract_id);
                                setSmsSelected(next);
                              }} />
                          </td>
                          <td className="p-2 text-white">{t.lessee_name} <span className="text-slate-500 text-xs">#{t.contract_number}</span></td>
                          <td className="p-2 text-slate-300 text-xs">{t.lessee_contact || <span className="text-red-400">없음</span>}</td>
                          <td className="p-2 text-slate-300">{t.distributor_name}</td>
                          <td className="p-2 text-slate-300 text-xs">{t.distributor_contact || <span className="text-red-400">없음</span>}</td>
                          <td className="p-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                              t.overdue_days >= 21 ? 'bg-red-500/20 text-red-300'
                              : t.overdue_days >= 14 ? 'bg-orange-500/20 text-orange-300'
                              : 'bg-yellow-500/20 text-yellow-300'
                            }`}>{t.overdue_days}일</span>
                          </td>
                          <td className="p-2 text-right text-red-400">{formatCurrency(t.total_unpaid)}</td>
                          <td className="p-2 text-center text-slate-300">{t.past_send_count} / {settings?.sms_max_count}</td>
                          <td className="p-2 text-center">
                            <button onClick={() => setPreviewing({ type: 'sms', contractId: t.contract_id })}
                              className="text-xs text-indigo-300 hover:text-indigo-100">👁 보기</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 신정사 메일 대기 */}
          {tab === 'agency' && (
            <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="text-xs text-slate-400">21일 이상 연체된 계약</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400">신정사:</span>
                  {settings?.credit_agencies.map((a, i) => (
                    <button key={i} onClick={() => setAgencyChoice(i)}
                      className={`text-xs px-3 py-1 rounded ${
                        agencyChoice === i ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'
                      }`}>
                      {a.name || `신정사 ${i + 1}`}
                    </button>
                  ))}
                  <button onClick={toggleAllAgency} className="text-xs text-slate-300 hover:text-white bg-slate-700 px-2 py-1 rounded">
                    {agencySelected.size === agencyTargets.length && agencyTargets.length > 0 ? '전체 해제' : '전체 선택'}
                  </button>
                  <button onClick={() => sendAgencyEmail(agencyTargets.filter(t => agencySelected.has(t.contract_id)))}
                    disabled={sending || agencySelected.size === 0}
                    className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 rounded">
                    {sending ? '발송 중...' : `선택 ${agencySelected.size}건 일괄 의뢰`}
                  </button>
                </div>
              </div>
              {agencyTargets.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-6">21일 이상 연체된 계약이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-800 z-10">
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="p-2 text-center w-8"></th>
                        <th className="p-2 text-left">계약자</th>
                        <th className="p-2 text-left">사업자번호</th>
                        <th className="p-2 text-left">총판</th>
                        <th className="p-2 text-center">연체</th>
                        <th className="p-2 text-right">미수액</th>
                        <th className="p-2 text-left">이전 발송</th>
                        <th className="p-2 text-center">미리보기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agencyTargets.map(t => (
                        <tr key={t.contract_id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                          <td className="p-2 text-center">
                            <input type="checkbox" checked={agencySelected.has(t.contract_id)}
                              onChange={() => {
                                const next = new Set(agencySelected);
                                if (next.has(t.contract_id)) next.delete(t.contract_id); else next.add(t.contract_id);
                                setAgencySelected(next);
                              }} />
                          </td>
                          <td className="p-2 text-white">{t.lessee_name} <span className="text-slate-500 text-xs">#{t.contract_number}</span></td>
                          <td className="p-2 text-slate-300 text-xs">{t.lessee_business_number || '-'}</td>
                          <td className="p-2 text-slate-300">{t.distributor_name}</td>
                          <td className="p-2 text-center">
                            <span className="bg-red-500/20 text-red-300 px-2 py-0.5 rounded text-xs font-bold">{t.overdue_days}일</span>
                          </td>
                          <td className="p-2 text-right text-red-400">{formatCurrency(t.total_unpaid)}</td>
                          <td className="p-2 text-xs">
                            {t.already_sent ? (
                              <span className="text-yellow-400">📩 {t.last_sent_agency || '?'} ({t.last_sent_at?.slice(0, 10)})</span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <button onClick={() => setPreviewing({ type: 'agency', contractId: t.contract_id })}
                              className="text-xs text-indigo-300 hover:text-indigo-100">👁 보기</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 이력 */}
          {tab === 'history' && (
            <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50">
              <p className="text-xs text-slate-400 mb-3">최근 50건</p>
              {history.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-6">이력이 없습니다.</p>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-800 z-10">
                      <tr className="text-slate-400 border-b border-slate-700">
                        <th className="p-2 text-left">시간</th>
                        <th className="p-2 text-left">종류</th>
                        <th className="p-2 text-left">수신</th>
                        <th className="p-2 text-left">대상</th>
                        <th className="p-2 text-center">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(h => (
                        <tr key={h.id} className="border-b border-slate-700/50">
                          <td className="p-2 text-slate-400 text-xs whitespace-nowrap">{h.created_at?.slice(0, 16).replace('T', ' ')}</td>
                          <td className="p-2 text-xs">
                            {h.action_type === 'sms_lessee' ? '📱 SMS(계약자)'
                              : h.action_type === 'sms_distributor' ? '📱 SMS(총판)'
                              : '📧 신정사 메일'}
                          </td>
                          <td className="p-2 text-slate-300 text-xs">{h.target_name || '-'}</td>
                          <td className="p-2 text-slate-400 text-xs">{h.target_address || '-'}</td>
                          <td className="p-2 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              h.status === 'sent' ? 'bg-green-500/20 text-green-300'
                              : h.status === 'failed' ? 'bg-red-500/20 text-red-300'
                              : 'bg-slate-500/20 text-slate-300'
                            }`}>{h.status}</span>
                            {h.is_mock && <span className="ml-1 text-[9px] text-yellow-500">MOCK</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 설정 */}
          {tab === 'settings' && settings && (
            <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50 space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm text-white">
                  <input type="checkbox" checked={settings.sms_auto_enabled}
                    onChange={e => setSettings({...settings, sms_auto_enabled: e.target.checked})} />
                  자동 SMS 발송 활성화
                  <InfoTooltip text="활성화 시 8일+ 연체 계약을 자동으로 큐에 올림. 발송 자체는 사용자가 승인 필요." />
                </label>
              </div>
              <div>
                <label className="text-xs text-slate-400">SMS 템플릿</label>
                <textarea value={settings.sms_template}
                  onChange={e => setSettings({...settings, sms_template: e.target.value})}
                  rows={3}
                  className="w-full mt-1 bg-slate-700 text-white text-sm rounded p-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                <p className="text-[10px] text-slate-500 mt-1">사용 가능 변수: {'{name}'} {'{days}'} {'{amount}'}</p>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-400">최대 발송 횟수</label>
                  <input type="number" value={settings.sms_max_count} min={1}
                    onChange={e => setSettings({...settings, sms_max_count: Number(e.target.value)})}
                    className="w-full mt-1 bg-slate-700 text-white text-sm rounded p-2" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-400">쿨다운 (일)</label>
                  <input type="number" value={settings.sms_cooldown_days} min={1}
                    onChange={e => setSettings({...settings, sms_cooldown_days: Number(e.target.value)})}
                    className="w-full mt-1 bg-slate-700 text-white text-sm rounded p-2" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">신정사 (2개)</label>
                <div className="space-y-2 mt-1">
                  {settings.credit_agencies.map((a, i) => (
                    <div key={i} className="flex gap-2">
                      <input value={a.name} onChange={e => {
                          const next = [...settings.credit_agencies];
                          next[i] = { ...next[i], name: e.target.value };
                          setSettings({...settings, credit_agencies: next});
                        }} placeholder={`신정사 ${i + 1} 이름`}
                        className="flex-1 bg-slate-700 text-white text-sm rounded p-2" />
                      <input value={a.email} onChange={e => {
                          const next = [...settings.credit_agencies];
                          next[i] = { ...next[i], email: e.target.value };
                          setSettings({...settings, credit_agencies: next});
                        }} placeholder="이메일"
                        className="flex-1 bg-slate-700 text-white text-sm rounded p-2" />
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={saveSettings}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded">
                설정 저장
              </button>
            </div>
          )}

          {/* 미리보기 모달 */}
          {previewing && previewContent && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
              onClick={() => setPreviewing(null)}>
              <div className="bg-slate-800 rounded-lg p-5 max-w-2xl w-full max-h-[80vh] overflow-y-auto border border-slate-600"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-white font-semibold">{previewContent.title}</h4>
                  <button onClick={() => setPreviewing(null)} className="text-slate-400 hover:text-white">✕</button>
                </div>
                {previewContent.items.map((it, i) => (
                  <div key={i} className="mb-3 bg-slate-900/60 rounded p-3 border border-slate-700">
                    <p className="text-xs text-slate-400">{it.label}</p>
                    <p className="text-sm text-slate-200 mb-2">{it.value}</p>
                    <pre className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-950/60 p-2 rounded">{it.body}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ))}
    </div>
  );
};
