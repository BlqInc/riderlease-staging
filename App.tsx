
import React, { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient';
import { Sidebar, View } from './components/Sidebar';
import { Login } from './components/Login';
import { ConfigurationError } from './components/ConfigurationError';
import { DistributorUpload } from './components/DistributorUpload';
import { ErrorBoundary } from './components/ErrorBoundary';

// Lazy-loaded view components
const Dashboard = React.lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const ContractManagement = React.lazy(() => import('./components/ContractManagement').then(m => ({ default: m.ContractManagement })));
const DeductionManagement = React.lazy(() => import('./components/DeductionManagement').then(m => ({ default: m.DeductionManagement })));
const ShippingManagement = React.lazy(() => import('./components/ShippingManagement').then(m => ({ default: m.ShippingManagement })));
const SettlementManagement = React.lazy(() => import('./components/SettlementManagement').then(m => ({ default: m.SettlementManagement })));
const CreditorSettlementData = React.lazy(() => import('./components/CreditorSettlementData').then(m => ({ default: m.CreditorSettlementData })));
const PartnersManagement = React.lazy(() => import('./components/PartnersManagement').then(m => ({ default: m.PartnersManagement })));
const Calendar = React.lazy(() => import('./components/Calendar').then(m => ({ default: m.Calendar })));
const DatabaseManagement = React.lazy(() => import('./components/DatabaseManagement').then(m => ({ default: m.DatabaseManagement })));
const CreditorSettlement = React.lazy(() => import('./components/CreditorSettlement').then(m => ({ default: m.CreditorSettlement })));
const CreditorBatch = React.lazy(() => import('./components/CreditorBatch').then(m => ({ default: m.CreditorBatch })));
const CollectionManagement = React.lazy(() => import('./components/CollectionManagement').then(m => ({ default: m.CollectionManagement })));
const ContractDocGenerator = React.lazy(() => import('./components/ContractDocGenerator').then(m => ({ default: m.ContractDocGenerator })));
const DocumentStatus = React.lazy(() => import('./components/DocumentStatus').then(m => ({ default: m.DocumentStatus })));
import { ContractFormModal } from './components/ContractFormModal';
import ContractDetailModal from './components/ContractDetailModal';

import { PartnerFormModal } from './components/PartnerFormModal';
import { PartnerDetailModal } from './components/PartnerDetailModal';
import { EventFormModal } from './components/EventFormModal';

import { Contract, Partner, CalendarEvent, Creditor, CreditorSettlementRound, DeductionStatus, PriceTier, SettlementStatus, ContractStatus } from './types';

// --- Pure helper functions (outside component for stable references) ---

const getToday = (): string => {
  const now = new Date();
  return new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
};

const calcUnpaidBalance = (daily_deductions: any[]): number => {
  const today = getToday();
  return (daily_deductions || []).reduce((sum: number, d: any) => {
    if (d.date > today) return sum;
    return sum + ((Number(d.amount) || 0) - (Number(d.paid_amount) || 0));
  }, 0);
};

const processContracts = (data: any[]): Contract[] => {
  if (!Array.isArray(data)) return [];
  const today = getToday();
  return data.map(c => {
    const units = (c.units_required && !isNaN(Number(c.units_required))) ? Number(c.units_required) : 1;
    const rawTotalAmount = (c.total_amount && !isNaN(Number(c.total_amount))) ? Number(c.total_amount) : 0;
    const rawDailyDeduction = (c.daily_deduction && !isNaN(Number(c.daily_deduction))) ? Number(c.daily_deduction) : 0;
    const total_amount = rawTotalAmount * units;
    const daily_deduction = rawDailyDeduction * units;
    const daily_deductions = Array.isArray(c.daily_deductions) ? c.daily_deductions : null;

    // 미납 잔액: 뷰의 사전계산값 우선, 없으면 daily_deductions로 폴백
    let unpaid_balance = 0;
    if (c.unpaid_balance_calc !== undefined && c.unpaid_balance_calc !== null) {
      unpaid_balance = Number(c.unpaid_balance_calc) || 0;
    } else if (daily_deductions) {
      for (let i = 0; i < daily_deductions.length; i++) {
        const d = daily_deductions[i];
        if (d.date > today) break;
        unpaid_balance += (Number(d.amount) || 0) - (Number(d.paid_amount) || 0);
      }
    }
    return {
      ...c,
      units_required: units,
      units_secured: (c.units_secured && !isNaN(Number(c.units_secured))) ? Number(c.units_secured) : 0,
      contract_number: (c.contract_number && !isNaN(Number(c.contract_number))) ? Number(c.contract_number) : 0,
      duration_days: (c.duration_days && !isNaN(Number(c.duration_days))) ? Number(c.duration_days) : 0,
      procurement_cost: (c.procurement_cost && !isNaN(Number(c.procurement_cost))) ? Number(c.procurement_cost) : null,
      contract_initial_deduction: (c.contract_initial_deduction && !isNaN(Number(c.contract_initial_deduction))) ? Number(c.contract_initial_deduction) : null,
      settlement_round: (c.settlement_round && !isNaN(Number(c.settlement_round))) ? Number(c.settlement_round) : null,
      total_amount,
      daily_deduction,
      unpaid_balance,
      daily_deductions,
    };
  });
};

// ---

// Wrapper to handle token-based routing before hooks
const AppRouter: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('token')) {
    return <DistributorUpload />;
  }
  return <App />;
};

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  // URL 해시에서 현재 탭 복원 (새로고침 후에도 유지)
  const [currentView, setCurrentViewRaw] = useState<View>(() => {
    const hash = window.location.hash.slice(1);
    return (hash || 'dashboard') as View;
  });
  const setCurrentView = useCallback((view: View) => {
    setCurrentViewRaw(view);
    window.location.hash = view;
  }, []);

  // 브라우저 뒤로가기/앞으로가기 지원
  useEffect(() => {
    const handlePopState = () => {
      const hash = window.location.hash.slice(1);
      setCurrentViewRaw((hash || 'dashboard') as View);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Data States
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [creditors, setCreditors] = useState<Creditor[]>([]);
  const [creditorSettlements, setCreditorSettlements] = useState<CreditorSettlementRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Modal States
  const [isContractFormOpen, setIsContractFormOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [contractFormTemplate, setContractFormTemplate] = useState<Partial<Contract> | null>(null);

  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);

  const [isPartnerFormOpen, setIsPartnerFormOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [isPartnerTemplateMode, setIsPartnerTemplateMode] = useState(false);

  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);

  const [isEventFormOpen, setIsEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent> | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    if (!supabase) return;
    if (!options?.silent) setLoading(true);
    setFetchError(null);
    try {
      // 계약 데이터: contracts_summary_light 뷰 사용 (daily_deductions 제외, 사전계산된 집계값 포함)
      // 1000건 제한 우회 → 2회 병렬 조회
      const [contractsRes1, contractsRes2, partnersRes, eventsRes, creditorsRes, creditorSettlementsRes] = await Promise.all([
        (supabase.from('contracts_summary_light') as any).select('*').order('contract_number', { ascending: false }).range(0, 999),
        (supabase.from('contracts_summary_light') as any).select('*').order('contract_number', { ascending: false }).range(1000, 2999),
        supabase.from('partners').select('*').order('name', { ascending: true }),
        supabase.from('events').select('*').order('date', { ascending: true }),
        (supabase.from('creditors') as any).select('*').order('display_order', { ascending: true }),
        (supabase.from('creditor_settlements') as any).select('*').order('settlement_round', { ascending: false }),
      ]);
      const allContracts = [...(contractsRes1.data || []), ...(contractsRes2.data || [])];
      if (partnersRes.error) throw new Error(`파트너 데이터 로드 실패: ${partnersRes.error.message}`);
      if (eventsRes.error) throw new Error(`일정 데이터 로드 실패: ${eventsRes.error.message}`);
      setContracts(processContracts(allContracts));
      setDeductionsLoaded(false); // 새 fetch 시 일차감 데이터도 다시 로드 필요
      setPartners(partnersRes.data || []);
      setEvents(eventsRes.data || []);
      if (creditorsRes.data) setCreditors(creditorsRes.data);
      if (creditorSettlementsRes.data) setCreditorSettlements(creditorSettlementsRes.data);
    } catch (error: any) {
      console.error('Error fetching data:', error);
      setFetchError(error.message || '데이터를 불러오는 중 알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const initializeSession = async () => {
      try {
        const { data: { session } } = await supabase!.auth.getSession();
        setSession(session);
        if (session) {
          await fetchData();
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error("Session initialization error:", error);
        setLoading(false);
      }
    };

    initializeSession();

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // TOKEN_REFRESHED, USER_UPDATED 등은 재조회 불필요 (이 경우 화면 깜빡임 방지)
      if (session && (_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION')) {
        fetchData();
      }
    });

    // --- Supabase Realtime: 다른 사용자의 변경사항을 실시간으로 수신 ---
    const realtimeChannel = supabase!
      .channel('db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setContracts(prev => {
            // 이미 있으면 중복 추가 방지 (내 optimistic update와 충돌 방지)
            if (prev.some(c => c.id === (payload.new as any).id)) return prev;
            return [processContracts([payload.new])[0], ...prev];
          });
        } else if (payload.eventType === 'UPDATE') {
          setContracts(prev => prev.map(c =>
            c.id === (payload.new as any).id ? processContracts([payload.new])[0] : c
          ));
        } else if (payload.eventType === 'DELETE') {
          setContracts(prev => prev.filter(c => c.id !== (payload.old as any).id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'partners' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setPartners(prev => {
            if (prev.some(p => p.id === (payload.new as any).id)) return prev;
            return [...prev, payload.new as Partner].sort((a, b) => String(a.name).localeCompare(String(b.name)));
          });
        } else if (payload.eventType === 'UPDATE') {
          setPartners(prev => prev.map(p =>
            p.id === (payload.new as any).id ? (payload.new as Partner) : p
          ));
        } else if (payload.eventType === 'DELETE') {
          setPartners(prev => prev.filter(p => p.id !== (payload.old as any).id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setEvents(prev => {
            if (prev.some(e => e.id === (payload.new as any).id)) return prev;
            return [...prev, payload.new as CalendarEvent].sort((a, b) => a.date.localeCompare(b.date));
          });
        } else if (payload.eventType === 'UPDATE') {
          setEvents(prev => prev.map(e =>
            e.id === (payload.new as any).id ? (payload.new as CalendarEvent) : e
          ));
        } else if (payload.eventType === 'DELETE') {
          setEvents(prev => prev.filter(e => e.id !== (payload.old as any).id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'creditor_settlements' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setCreditorSettlements(prev => {
            if (prev.some(s => s.id === (payload.new as any).id)) return prev;
            return [payload.new as CreditorSettlementRound, ...prev];
          });
        } else if (payload.eventType === 'UPDATE') {
          setCreditorSettlements(prev => prev.map(s =>
            s.id === (payload.new as any).id ? (payload.new as CreditorSettlementRound) : s
          ));
        } else if (payload.eventType === 'DELETE') {
          setCreditorSettlements(prev => prev.filter(s => s.id !== (payload.old as any).id));
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'creditors' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setCreditors(prev => {
            if (prev.some(c => c.id === (payload.new as any).id)) return prev;
            return [...prev, payload.new as Creditor];
          });
        } else if (payload.eventType === 'UPDATE') {
          setCreditors(prev => prev.map(c =>
            c.id === (payload.new as any).id ? (payload.new as Creditor) : c
          ));
        } else if (payload.eventType === 'DELETE') {
          setCreditors(prev => prev.filter(c => c.id !== (payload.old as any).id));
        }
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
      supabase!.removeChannel(realtimeChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Contract Handlers ---

  const handleSaveContract = useCallback(async (contractData: any) => {
    if (!supabase) return;

    const { id, unpaid_balance, daily_deductions: _ignored, ...dataToSave } = contractData;

    const units = Number(dataToSave.units_required || 1);
    const unitDailyDeduction = Number(dataToSave.daily_deduction || 0);
    const totalDailyDeduction = unitDailyDeduction * units;

    const generateDeductions = (startStr: string, duration: number, amount: number) => {
      if (!startStr || duration <= 0) return null;
      const logs = [];
      const parts = startStr.split('-').map(Number);
      const startDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      for (let i = 0; i < duration; i++) {
        const d = new Date(startDate);
        d.setUTCDate(d.getUTCDate() + i);
        logs.push({
          id: `ded-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`,
          date: d.toISOString().split('T')[0],
          amount: amount,
          status: DeductionStatus.UNPAID,
          paid_amount: 0,
        });
      }
      return logs;
    };

    try {
      if (id) {
        const existingContract = contracts.find(c => c.id === id);
        let payload: any = { ...dataToSave };

        if (existingContract) {
          const newStart = dataToSave.execution_date || dataToSave.contract_date;
          const newDuration = Number(dataToSave.duration_days);
          const oldStart = existingContract.execution_date || existingContract.contract_date;
          const oldDuration = existingContract.duration_days;
          const oldTotalDailyDeduction = existingContract.daily_deduction;
          const currentLogs = existingContract.daily_deductions || [];
          const hasNoDeductions = currentLogs.length === 0;
          const firstLogDate = currentLogs.length > 0 ? currentLogs[0].date : null;
          const isDateMismatch = firstLogDate && newStart && firstLogDate !== newStart;
          const fieldsChanged =
            newStart !== oldStart ||
            newDuration !== oldDuration ||
            totalDailyDeduction !== oldTotalDailyDeduction ||
            isDateMismatch;

          if (fieldsChanged || hasNoDeductions) {
            const newDeductions = generateDeductions(newStart, newDuration, totalDailyDeduction);
            if (newDeductions) payload.daily_deductions = newDeductions;
          }
        }

        const { error } = await (supabase.from('contracts') as any).update(payload).eq('id', id);
        if (error) throw error;

        // Fetch only this one contract instead of all data
        const { data: updated } = await supabase.from('contracts').select('*').eq('id', id).single();
        if (updated) {
          setContracts(prev => prev.map(c => c.id === id ? processContracts([updated])[0] : c));
        }
      } else {
        const maxNumber = contracts.reduce((max, c) => Math.max(max, c.contract_number || 0), 0);
        const newStart = dataToSave.execution_date || dataToSave.contract_date;
        const duration = Number(dataToSave.duration_days || 0);
        const newDeductions = generateDeductions(newStart, duration, totalDailyDeduction);
        const payload = {
          ...dataToSave,
          contract_number: maxNumber + 1,
          daily_deductions: newDeductions,
        };

        const { data: inserted, error } = await (supabase.from('contracts') as any).insert(payload).select().single();
        if (error) throw error;
        if (inserted) {
          setContracts(prev => [processContracts([inserted])[0], ...prev]);
        }
      }

      setIsContractFormOpen(false);
      setEditingContract(null);
      setContractFormTemplate(null);
    } catch (error: any) {
      console.error('Error saving contract:', error);
      alert(`계약 저장 실패: ${error.message}`);
    }
  }, [contracts]);

  // 상세 모달 열 때 daily_deductions를 풀로 가져옴 (뷰에는 없으므로)
  const selectContractWithDeductions = useCallback(async (c: Contract) => {
    if (!c.daily_deductions && supabase) {
      const { data } = await (supabase.from('contracts') as any).select('daily_deductions').eq('id', c.id).single();
      setSelectedContract({ ...c, daily_deductions: data?.daily_deductions || [] } as any);
    } else {
      setSelectedContract(c);
    }
  }, []);

  // 일차감 관리 진입 시 모든 contracts의 daily_deductions를 풀로 가져와 보강
  const [deductionsLoaded, setDeductionsLoaded] = useState(false);
  const loadAllDeductions = useCallback(async () => {
    if (deductionsLoaded || !supabase) return;
    const [r1, r2] = await Promise.all([
      (supabase.from('contracts') as any).select('id, daily_deductions').range(0, 999),
      (supabase.from('contracts') as any).select('id, daily_deductions').range(1000, 2999),
    ]);
    const all = [...(r1.data || []), ...(r2.data || [])];
    const map = new Map(all.map((c: any) => [c.id, c.daily_deductions]));
    setContracts(prev => prev.map(c => ({ ...c, daily_deductions: map.get(c.id) || c.daily_deductions || [] })));
    setDeductionsLoaded(true);
  }, [deductionsLoaded]);

  useEffect(() => {
    if (currentView === 'deductionManagement' && !deductionsLoaded) {
      loadAllDeductions();
    }
  }, [currentView, deductionsLoaded, loadAllDeductions]);

  const handleDeleteContract = useCallback(async (id: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('contracts').delete().eq('id', id);
      if (error) throw error;
      setContracts(prev => prev.filter(c => c.id !== id));
      setSelectedContract(null);
    } catch (error: any) {
      console.error('Error deleting contract:', error);
      alert(`계약 삭제 실패: ${error.message}`);
    }
  }, []);

  const handleImportContracts = useCallback(async (newContracts: any[]) => {
    if (!supabase) return;
    let currentMaxNumber = contracts.reduce((max, c) => Math.max(max, c.contract_number || 0), 0);
    const contractsWithNumbers = newContracts.map(c => {
      currentMaxNumber += 1;
      return { ...c, contract_number: currentMaxNumber };
    });
    try {
      const { error } = await (supabase.from('contracts') as any).insert(contractsWithNumbers);
      if (error) throw error;
      fetchData({ silent: true });
    } catch (error: any) {
      console.error('Error importing contracts:', error);
      throw error;
    }
  }, [contracts, fetchData]);

  // --- Partner Handlers ---

  const handleSavePartner = useCallback(async (partnerData: any) => {
    if (!supabase) return;
    const { id, ...dataToSave } = partnerData;
    try {
      if (id) {
        const { error } = await (supabase.from('partners') as any).update(dataToSave).eq('id', id);
        if (error) throw error;
        setPartners(prev => prev.map(p => p.id === id ? { ...p, ...dataToSave } : p));
      } else {
        const { data: newPartner, error } = await (supabase.from('partners') as any).insert(dataToSave).select().single();
        if (error) throw error;
        setPartners(prev => [...prev, newPartner].sort((a: Partner, b: Partner) => String(a.name).localeCompare(String(b.name))));
      }
      setIsPartnerFormOpen(false);
      setEditingPartner(null);
    } catch (error: any) {
      console.error('Error saving partner:', error);
      alert(`파트너 저장 실패: ${error.message}`);
    }
  }, []);

  const handleDeletePartner = useCallback(async (id: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('partners').delete().eq('id', id);
      if (error) throw error;
      setPartners(prev => prev.filter(p => p.id !== id));
      setSelectedPartnerId(null);
    } catch (error: any) {
      console.error('Error deleting partner:', error);
      alert(`파트너 삭제 실패: ${error.message}`);
    }
  }, []);

  const handleUpdatePriceTier = useCallback(async (partnerId: string, priceTierId: string, data: Partial<PriceTier>) => {
    const partner = partners.find(p => p.id === partnerId);
    if (!partner || !partner.price_list) return;
    const newPriceList = partner.price_list.map(p => p.id === priceTierId ? { ...p, ...data } : p);
    await handleSavePartner({ id: partnerId, price_list: newPriceList });
  }, [partners, handleSavePartner]);

  const handleDeletePriceTier = useCallback(async (partnerId: string, priceTierId: string) => {
    const partner = partners.find(p => p.id === partnerId);
    if (!partner || !partner.price_list) return;
    const newPriceList = partner.price_list.filter(p => p.id !== priceTierId);
    await handleSavePartner({ id: partnerId, price_list: newPriceList });
  }, [partners, handleSavePartner]);

  const handleAddPriceTier = useCallback(async (partnerId: string, tierData: Omit<PriceTier, 'id'>) => {
    const partner = partners.find(p => p.id === partnerId);
    if (!partner) return;
    const newTier = { ...tierData, id: `pt-${Date.now()}` };
    const newPriceList = [...(partner.price_list || []), newTier];
    await handleSavePartner({ id: partnerId, price_list: newPriceList });
  }, [partners, handleSavePartner]);

  const handleAddPriceTiersFromMaster = useCallback(async (partnerId: string, tiers: PriceTier[]) => {
    const partner = partners.find(p => p.id === partnerId);
    if (!partner) return;
    const newTiers = tiers.map(t => ({ ...t, id: `pt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` }));
    const newPriceList = [...(partner.price_list || []), ...newTiers];
    await handleSavePartner({ id: partnerId, price_list: newPriceList });
  }, [partners, handleSavePartner]);

  // --- Event Handlers ---

  const handleSaveEvent = useCallback(async (eventData: any) => {
    if (!supabase) return;
    const { id, ...dataToSave } = eventData;
    try {
      if (id) {
        const { error } = await (supabase.from('events') as any).update(dataToSave).eq('id', id);
        if (error) throw error;
        setEvents(prev => prev.map(e => e.id === id ? { ...e, ...dataToSave } : e));
      } else {
        const { data: newEvent, error } = await (supabase.from('events') as any).insert(dataToSave).select().single();
        if (error) throw error;
        setEvents(prev => [...prev, newEvent].sort((a: CalendarEvent, b: CalendarEvent) => a.date.localeCompare(b.date)));
      }
      setIsEventFormOpen(false);
      setEditingEvent(null);
    } catch (error: any) {
      console.error('Error saving event:', error);
      alert(`일정 저장 실패: ${error.message}`);
    }
  }, []);

  const handleDeleteEvent = useCallback(async (id: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
      setEvents(prev => prev.filter(e => e.id !== id));
      setIsEventFormOpen(false);
      setEditingEvent(null);
    } catch (error: any) {
      console.error('Error deleting event:', error);
      alert(`일정 삭제 실패: ${error.message}`);
    }
  }, []);

  // --- Deduction/Settlement Logic ---

  const handleAddPayment = useCallback(async (contractId: string, amount: number) => {
    if (!supabase) return;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.daily_deductions) return;

    let remainingAmount = amount;
    const sortedDeductions = [...contract.daily_deductions].sort(
      (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );

    const updatedDeductions = sortedDeductions.map(d => {
      if (remainingAmount <= 0 || d.status === DeductionStatus.PAID) return d;
      const unpaidPortion = d.amount - d.paid_amount;
      const paymentForThis = Math.min(remainingAmount, unpaidPortion);
      const newPaidAmount = d.paid_amount + paymentForThis;
      remainingAmount -= paymentForThis;
      let status: DeductionStatus = d.status;
      if (newPaidAmount >= d.amount) status = DeductionStatus.PAID;
      else if (newPaidAmount > 0) status = DeductionStatus.PARTIAL;
      return { ...d, paid_amount: newPaidAmount, status };
    });

    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ daily_deductions: updatedDeductions })
        .eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c =>
        c.id === contractId
          ? { ...c, daily_deductions: updatedDeductions, unpaid_balance: calcUnpaidBalance(updatedDeductions) }
          : c
      ) as Contract[]);
    } catch (error: any) {
      alert(`입금 처리 실패: ${error.message}`);
    }
  }, [contracts]);

  // 총판별 기간 일괄 납부 처리
  const handleBulkDistributorPayment = useCallback(async (
    distributorName: string,
    dateFrom: string,
    dateTo: string,
    inputAmount: number,
    excludeContractIds: string[]
  ) => {
    if (!supabase) return;

    // 해당 총판의 계약 중 제외 건 + 실행일 미래 건을 뺀 목록
    const today = getToday();
    const targetContracts = contracts.filter(c =>
      c.distributor_name === distributorName &&
      !excludeContractIds.includes(c.id) &&
      c.status === '진행중' &&
      (!c.execution_date || c.execution_date <= today)
    );

    // daily_deductions가 없으면 먼저 로드
    const contractsToProcess: Contract[] = [];
    for (const c of targetContracts) {
      if (c.daily_deductions) {
        contractsToProcess.push(c);
      } else {
        const { data } = await (supabase.from('contracts') as any).select('daily_deductions').eq('id', c.id).single();
        contractsToProcess.push({ ...c, daily_deductions: data?.daily_deductions || [] });
      }
    }

    // 기간 내 미납 차감분을 오래된 순서대로 모아서 금액 배분
    let remaining = inputAmount;
    const updates: { contractId: string; deductions: any[] }[] = [];

    for (const contract of contractsToProcess) {
      const deductions = [...(contract.daily_deductions || [])].sort(
        (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0
      );
      let changed = false;
      const updated = deductions.map(d => {
        if (remaining <= 0 || d.status === '납부완료') return d;
        if (d.date < dateFrom || d.date > dateTo) return d;
        const unpaid = d.amount - d.paid_amount;
        if (unpaid <= 0) return d;
        const payment = Math.min(remaining, unpaid);
        remaining -= payment;
        changed = true;
        const newPaid = d.paid_amount + payment;
        return { ...d, paid_amount: newPaid, status: newPaid >= d.amount ? '납부완료' : '부분납부' };
      });
      if (changed) updates.push({ contractId: contract.id, deductions: updated });
    }

    // DB 업데이트
    try {
      for (const u of updates) {
        await (supabase.from('contracts') as any)
          .update({ daily_deductions: u.deductions })
          .eq('id', u.contractId);
      }
      // 로컬 상태 업데이트
      const updateMap = new Map(updates.map(u => [u.contractId, u.deductions]));
      setContracts(prev => prev.map(c => {
        const newDed = updateMap.get(c.id);
        if (!newDed) return c;
        return { ...c, daily_deductions: newDed, unpaid_balance: calcUnpaidBalance(newDed) };
      }) as Contract[]);
      return { processed: updates.length, remaining };
    } catch (error: any) {
      alert(`일괄 납부 처리 실패: ${error.message}`);
      return { processed: 0, remaining: inputAmount };
    }
  }, [contracts]);

  const handleSettleDeduction = useCallback(async (contractId: string, deductionId: string) => {
    if (!supabase) return;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.daily_deductions) return;

    const updatedDeductions = contract.daily_deductions.map(d =>
      d.id === deductionId ? { ...d, paid_amount: d.amount, status: DeductionStatus.PAID } : d
    );
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ daily_deductions: updatedDeductions })
        .eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c =>
        c.id === contractId
          ? { ...c, daily_deductions: updatedDeductions, unpaid_balance: calcUnpaidBalance(updatedDeductions) }
          : c
      ));
    } catch (error: any) {
      alert(`처리 실패: ${error.message}`);
    }
  }, [contracts]);

  const handleCancelDeduction = useCallback(async (contractId: string, deductionId: string) => {
    if (!supabase) return;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.daily_deductions) return;

    const updatedDeductions = contract.daily_deductions.map(d =>
      d.id === deductionId ? { ...d, paid_amount: 0, status: DeductionStatus.UNPAID } : d
    );
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ daily_deductions: updatedDeductions })
        .eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c =>
        c.id === contractId
          ? { ...c, daily_deductions: updatedDeductions, unpaid_balance: calcUnpaidBalance(updatedDeductions) }
          : c
      ));
    } catch (error: any) {
      alert(`취소 실패: ${error.message}`);
    }
  }, [contracts]);

  const handleBulkCancelDeductions = useCallback(async (contractId: string, deductionIds: string[]) => {
    if (!supabase) return;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.daily_deductions) return;
    const idSet = new Set(deductionIds);
    const updatedDeductions = contract.daily_deductions.map(d =>
      idSet.has(d.id) && d.status === DeductionStatus.PAID
        ? { ...d, status: DeductionStatus.UNPAID, paid_amount: 0 }
        : d
    );
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ daily_deductions: updatedDeductions })
        .eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c =>
        c.id === contractId
          ? { ...c, daily_deductions: updatedDeductions, unpaid_balance: calcUnpaidBalance(updatedDeductions) }
          : c
      ) as Contract[]);
    } catch (error: any) {
      alert(`일괄 납부 취소 실패: ${error.message}`);
    }
  }, [contracts]);

  const handleToggleLawsuit = useCallback(async (contractId: string) => {
    if (!supabase) return;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;
    const newValue = !contract.is_lawsuit;
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ is_lawsuit: newValue })
        .eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c => c.id === contractId ? { ...c, is_lawsuit: newValue } : c));
    } catch (error: any) {
      alert(`처리 실패: ${error.message}`);
    }
  }, [contracts]);

  const handleBulkSettleDeductions = useCallback(async (contractId: string, deductionIds: string[]) => {
    if (!supabase) return;
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.daily_deductions) return;
    const idSet = new Set(deductionIds);
    const updatedDeductions = contract.daily_deductions.map(d =>
      idSet.has(d.id) && d.status !== DeductionStatus.PAID
        ? { ...d, status: DeductionStatus.PAID, paid_amount: d.amount }
        : d
    );
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ daily_deductions: updatedDeductions })
        .eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c =>
        c.id === contractId
          ? { ...c, daily_deductions: updatedDeductions, unpaid_balance: calcUnpaidBalance(updatedDeductions) }
          : c
      ));
    } catch (error: any) {
      alert(`처리 실패: ${error.message}`);
    }
  }, [contracts]);

  const handleUpdatePrerequisites = useCallback(async (contractId: string, updates: any) => {
    if (!supabase) return;
    try {
      const { error } = await (supabase.from('contracts') as any).update(updates).eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c => c.id === contractId ? { ...c, ...updates } : c));
    } catch (error: any) {
      alert(`업데이트 실패: ${error.message}`);
    }
  }, []);

  const handleRequestSettlement = useCallback(async (contractId: string) => {
    if (!supabase) return;
    const now = new Date().toISOString();
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ settlement_status: SettlementStatus.REQUESTED, settlement_request_date: now })
        .eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c =>
        c.id === contractId ? { ...c, settlement_status: SettlementStatus.REQUESTED, settlement_request_date: now } : c
      ));
    } catch (error: any) {
      alert(`요청 실패: ${error.message}`);
    }
  }, []);

  const handleCompleteSettlement = useCallback(async (contractId: string) => {
    if (!supabase) return;
    const now = new Date().toISOString();
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ settlement_status: SettlementStatus.COMPLETED, status: ContractStatus.SETTLED, settlement_date: now })
        .eq('id', contractId);
      if (error) throw error;
      setContracts(prev => prev.map(c =>
        c.id === contractId ? { ...c, settlement_status: SettlementStatus.COMPLETED, status: ContractStatus.SETTLED, settlement_date: now } : c
      ));
    } catch (error: any) {
      alert(`완료 처리 실패: ${error.message}`);
    }
  }, []);

  const handleBulkRequestSettlement = useCallback(async (ids: string[]) => {
    if (!supabase) return;
    const now = new Date().toISOString();
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ settlement_status: SettlementStatus.REQUESTED, settlement_request_date: now })
        .in('id', ids);
      if (error) throw error;
      const idSet = new Set(ids);
      setContracts(prev => prev.map(c =>
        idSet.has(c.id) ? { ...c, settlement_status: SettlementStatus.REQUESTED, settlement_request_date: now } : c
      ));
    } catch (error: any) {
      alert(`일괄 요청 실패: ${error.message}`);
    }
  }, []);

  const handleBulkCompleteSettlement = useCallback(async (ids: string[]) => {
    if (!supabase) return;
    const now = new Date().toISOString();
    try {
      const { error } = await (supabase.from('contracts') as any)
        .update({ settlement_status: SettlementStatus.COMPLETED, status: ContractStatus.SETTLED, settlement_date: now })
        .in('id', ids);
      if (error) throw error;
      const idSet = new Set(ids);
      setContracts(prev => prev.map(c =>
        idSet.has(c.id) ? { ...c, settlement_status: SettlementStatus.COMPLETED, status: ContractStatus.SETTLED, settlement_date: now } : c
      ));
    } catch (error: any) {
      alert(`일괄 완료 실패: ${error.message}`);
    }
  }, []);

  // --- Creditor Settlement Handlers ---

  const handleSaveCreditorSettlement = useCallback(async (data: Omit<CreditorSettlementRound, 'id' | 'created_at'> & { id?: string }) => {
    if (!supabase) return;
    try {
      if (data.id) {
        const { id, ...dataToSave } = data;
        const { data: updated, error } = await (supabase.from('creditor_settlements') as any).update(dataToSave).eq('id', id).select().single();
        if (error) throw error;
        if (updated) setCreditorSettlements(prev => prev.map(s => s.id === updated.id ? updated : s));
      } else {
        const { id: _, ...dataToSave } = data;
        const { data: created, error } = await (supabase.from('creditor_settlements') as any).insert(dataToSave).select().single();
        if (error) throw error;
        if (created) setCreditorSettlements(prev => [created, ...prev]);
      }
    } catch (error: any) {
      alert(`저장 실패: ${error.message}`);
    }
  }, []);

  const handleDeleteCreditorSettlement = useCallback(async (id: string) => {
    if (!supabase) return;
    try {
      const { error } = await (supabase.from('creditor_settlements') as any).delete().eq('id', id);
      if (error) throw error;
      setCreditorSettlements(prev => prev.filter(s => s.id !== id));
    } catch (error: any) {
      alert(`삭제 실패: ${error.message}`);
    }
  }, []);

  const handleSaveCreditor = useCallback(async (name: string) => {
    if (!supabase) return;
    const maxOrder = creditors.reduce((max, c) => Math.max(max, c.display_order), 0);
    const { data: created } = await (supabase.from('creditors') as any).insert({ name, display_order: maxOrder + 1 }).select().single();
    if (created) setCreditors(prev => [...prev, created]);
  }, [creditors]);

  const handleDeleteCreditor = useCallback(async (id: string) => {
    if (!supabase) return;
    await (supabase.from('creditor_settlements') as any).delete().eq('creditor_id', id);
    await (supabase.from('creditors') as any).delete().eq('id', id);
    setCreditors(prev => prev.filter(c => c.id !== id));
    setCreditorSettlements(prev => prev.filter(s => s.creditor_id !== id));
  }, []);

  if (!isSupabaseConfigured) {
    return <ConfigurationError />;
  }

  if (!session) {
    return <Login />;
  }

  const selectedPartner = partners.find(p => p.id === selectedPartnerId) || null;

  return (
    <div className="flex h-screen bg-slate-900 text-white overflow-hidden">
      <Sidebar
        currentView={currentView}
        onNavigate={setCurrentView}
        onLogout={() => supabase!.auth.signOut()}
      />

      <main className="flex-1 ml-64 overflow-y-auto h-full">
        <ErrorBoundary>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-indigo-500"></div>
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center h-full p-8">
              <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center max-w-lg">
                <h2 className="text-2xl font-bold text-red-400 mb-2">데이터 로딩 실패</h2>
                <p className="text-slate-300 mb-4">{fetchError}</p>
                <button
                  onClick={() => fetchData()}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                >
                  다시 시도
                </button>
              </div>
            </div>
          ) : (
            <React.Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-indigo-500"></div></div>}>
              {currentView === 'dashboard' && <Dashboard contracts={contracts} partners={partners} />}
              {currentView === 'contractManagement' && (
                <ContractManagement
                  contracts={contracts}
                  partners={partners}
                  onSelectContract={selectContractWithDeductions}
                  onAddContract={(template) => {
                    setEditingContract(null);
                    setContractFormTemplate(template || null);
                    setIsContractFormOpen(true);
                  }}
                  onImportContracts={handleImportContracts}
                  onDeleteContracts={async (ids) => {
                    if (!supabase) return;
                    for (const id of ids) {
                      await supabase.from('contracts').delete().eq('id', id);
                    }
                    setContracts(prev => prev.filter(c => !ids.includes(c.id)));
                  }}
                />
              )}
              {currentView === 'collectionManagement' && <CollectionManagement contracts={contracts} partners={partners} onBulkDistributorPayment={handleBulkDistributorPayment} />}
              {currentView === 'deductionManagement' && (
                <DeductionManagement
                  contracts={contracts}
                  partners={partners}
                  onAddPayment={handleAddPayment}
                  onSettleDeduction={handleSettleDeduction}
                  onCancelDeduction={handleCancelDeduction}
                  onToggleLawsuit={handleToggleLawsuit}
                  onBulkSettleDeductions={handleBulkSettleDeductions}
                  onBulkCancelDeductions={handleBulkCancelDeductions}
                />
              )}
              {currentView === 'shippingManagement' && (
                <ShippingManagement contracts={contracts} partners={partners} onSelectContract={selectContractWithDeductions} />
              )}
              {currentView === 'settlementManagement' && (
                <SettlementManagement
                  contracts={contracts}
                  partners={partners}
                  onSelectContract={selectContractWithDeductions}
                  onRequestSettlement={handleRequestSettlement}
                  onCompleteSettlement={handleCompleteSettlement}
                  onUpdatePrerequisites={handleUpdatePrerequisites}
                  onBulkRequestSettlement={handleBulkRequestSettlement}
                  onBulkCompleteSettlement={handleBulkCompleteSettlement}
                />
              )}
              {currentView === 'creditorSettlementData' && <CreditorSettlementData contracts={contracts} />}
              {currentView === 'creditorBatch' && <CreditorBatch contracts={contracts} />}
              {currentView === 'documentStatus' && <DocumentStatus partners={partners} contracts={contracts} onContractCreated={() => fetchData({ silent: true })} />}
              {currentView === 'contractDocGenerator' && <ContractDocGenerator />}
              {currentView === 'partners' && (
                <PartnersManagement
                  partners={partners}
                  onSelectPartner={(id) => setSelectedPartnerId(id)}
                  onAddPartner={() => { setEditingPartner(null); setIsPartnerTemplateMode(false); setIsPartnerFormOpen(true); }}
                  onAddTemplate={() => { setEditingPartner(null); setIsPartnerTemplateMode(true); setIsPartnerFormOpen(true); }}
                />
              )}
              {currentView === 'calendar' && (
                <Calendar
                  events={events}
                  onAddEvent={(date) => { setSelectedDate(date); setEditingEvent(null); setIsEventFormOpen(true); }}
                  onEditEvent={(event) => { setEditingEvent(event); setIsEventFormOpen(true); }}
                />
              )}
              {currentView === 'database' && <DatabaseManagement />}
              {currentView === 'creditorSettlement' && (
                <CreditorSettlement
                  contracts={contracts}
                  creditors={creditors}
                  settlements={creditorSettlements}
                  onSaveSettlement={handleSaveCreditorSettlement}
                  onDeleteSettlement={handleDeleteCreditorSettlement}
                  onSaveCreditor={handleSaveCreditor}
                  onDeleteCreditor={handleDeleteCreditor}
                />
              )}
            </React.Suspense>
          )}
        </ErrorBoundary>
      </main>

      {/* Modals */}

      {isContractFormOpen && (
        <ContractFormModal
          isOpen={isContractFormOpen}
          onClose={() => { setIsContractFormOpen(false); setContractFormTemplate(null); }}
          onSave={handleSaveContract}
          partners={partners}
          contractToEdit={editingContract}
          template={contractFormTemplate}
          creditors={creditors}
        />
      )}

      {selectedContract && (
        <ContractDetailModal
          contract={selectedContract}
          partner={partners.find(p => p.id === selectedContract.partner_id) || null}
          onClose={() => setSelectedContract(null)}
          onEdit={(c) => { setSelectedContract(null); setEditingContract(c); setIsContractFormOpen(true); }}
          onDelete={handleDeleteContract}
          onDuplicate={(c) => {
            setSelectedContract(null);
            const { id, contract_number, ...rest } = c;
            setContractFormTemplate(rest);
            setEditingContract(null);
            setIsContractFormOpen(true);
          }}
        />
      )}

      {isPartnerFormOpen && (
        <PartnerFormModal
          isOpen={isPartnerFormOpen}
          onClose={() => setIsPartnerFormOpen(false)}
          onSave={handleSavePartner}
          partnerToEdit={editingPartner}
          isTemplate={isPartnerTemplateMode}
        />
      )}

      {selectedPartner && (
        <PartnerDetailModal
          partner={selectedPartner}
          priceTemplates={partners.filter(p => p.is_template)}
          onClose={() => setSelectedPartnerId(null)}
          onEdit={(p) => { setSelectedPartnerId(null); setEditingPartner(p); setIsPartnerFormOpen(true); }}
          onDelete={handleDeletePartner}
          onAddPriceTier={handleAddPriceTier}
          onUpdatePriceTier={handleUpdatePriceTier}
          onDeletePriceTier={handleDeletePriceTier}
          onAddPriceTiersFromMaster={handleAddPriceTiersFromMaster}
        />
      )}

      {isEventFormOpen && (
        <EventFormModal
          isOpen={isEventFormOpen}
          onClose={() => setIsEventFormOpen(false)}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          eventToEdit={editingEvent}
          selectedDate={selectedDate}
        />
      )}
    </div>
  );
};

export default AppRouter;
