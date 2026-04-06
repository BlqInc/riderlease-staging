// Build Fix Path Check: Root Version 1.0.3
import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient';
import { Sidebar, View } from './components/Sidebar';
import { Login } from './components/Login';
import { ConfigurationError } from './components/ConfigurationError';
import { Dashboard } from './components/Dashboard';
import { ContractManagement } from './components/ContractManagement';
import { DeductionManagement } from './components/DeductionManagement';
import { ShippingManagement } from './components/ShippingManagement';
import { SettlementManagement } from './components/SettlementManagement';
import { CreditorSettlementData } from './components/CreditorSettlementData';
import { CreditorBatch } from './components/CreditorBatch';
import { PartnersManagement } from './components/PartnersManagement';
import { Calendar } from './components/Calendar';
import { DatabaseManagement } from './components/DatabaseManagement';
import { CreditorSettlement } from './components/CreditorSettlement';
import { PrivacyMasking } from './components/PrivacyMasking';
import { CollectionManagement } from './components/CollectionManagement';
import { ContractDocGenerator } from './components/ContractDocGenerator';
import { DocumentStatus } from './components/DocumentStatus';
import { DistributorUpload } from './components/DistributorUpload';
import { ErrorBoundary } from './components/ErrorBoundary';

import { ContractFormModal } from './ContractFormModal';
import ContractDetailModal from './components/ContractDetailModal';
import { PartnerFormModal } from './components/PartnerFormModal';
import { PartnerDetailModal } from './components/PartnerDetailModal';
import { EventFormModal } from './components/EventFormModal';

import { Contract, Partner, CalendarEvent, Creditor, CreditorSettlementRound, DeductionStatus } from './types';

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
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [creditors, setCreditors] = useState<Creditor[]>([]);
  const [creditorSettlements, setCreditorSettlements] = useState<CreditorSettlementRound[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase!.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchData();
      else setLoading(false);
    });

    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchData();
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchData = async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const [contractsRes, partnersRes, eventsRes, creditorsRes, creditorSettlementsRes] = await Promise.all([
        supabase.from('contracts').select('*').order('created_at', { ascending: false }),
        supabase.from('partners').select('*').order('created_at', { ascending: false }),
        supabase.from('events').select('*').order('date', { ascending: true }),
        supabase.from('creditors').select('*').order('display_order', { ascending: true }),
        supabase.from('creditor_settlements').select('*').order('settlement_round', { ascending: false })
      ]);

      if (contractsRes.data) setContracts(contractsRes.data as any);
      if (partnersRes.data) setPartners(partnersRes.data);
      if (eventsRes.data) setEvents(eventsRes.data);
      if (creditorsRes.data) setCreditors(creditorsRes.data);
      if (creditorSettlementsRes.data) setCreditorSettlements(creditorSettlementsRes.data);
    } catch (e) {
      console.error("Data Fetch Error:", e);
    } finally {
      setLoading(false);
    }
  };

  // 일차감: 입금 처리 (오래된 미납일부터 순서대로 자동 배분)
  const handleAddPayment = async (contractId: string, amount: number) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !supabase) return;

    let remaining = amount;
    const sorted = [...(contract.daily_deductions || [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const updatedDeductions = sorted.map(d => {
      if (remaining <= 0 || d.status === DeductionStatus.PAID) return d;
      const owed = d.amount - d.paid_amount;
      if (owed <= 0) return d;
      const payment = Math.min(owed, remaining);
      remaining -= payment;
      const newPaid = d.paid_amount + payment;
      return {
        ...d,
        paid_amount: newPaid,
        status: newPaid >= d.amount ? DeductionStatus.PAID : DeductionStatus.PARTIAL,
      };
    });
    const unpaidBalance = updatedDeductions.reduce((sum, d) => sum + (d.amount - d.paid_amount), 0);

    const { data } = await supabase
      .from('contracts')
      .update({ daily_deductions: updatedDeductions, unpaid_balance: unpaidBalance })
      .eq('id', contractId)
      .select()
      .single();
    if (data) setContracts(prev => prev.map(c => c.id === contractId ? { ...data, unpaid_balance: unpaidBalance } : c));
  };

  // 일차감: 특정 날짜 전액 처리
  const handleSettleDeduction = async (contractId: string, deductionId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !supabase) return;

    const updatedDeductions = (contract.daily_deductions || []).map(d =>
      d.id === deductionId ? { ...d, status: DeductionStatus.PAID, paid_amount: d.amount } : d
    );
    const unpaidBalance = updatedDeductions.reduce((sum, d) => sum + (d.amount - d.paid_amount), 0);

    const { data } = await supabase
      .from('contracts')
      .update({ daily_deductions: updatedDeductions, unpaid_balance: unpaidBalance })
      .eq('id', contractId)
      .select()
      .single();
    if (data) setContracts(prev => prev.map(c => c.id === contractId ? { ...data, unpaid_balance: unpaidBalance } : c));
  };

  // 일차감: 납부 취소
  const handleCancelDeduction = async (contractId: string, deductionId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !supabase) return;

    const updatedDeductions = (contract.daily_deductions || []).map(d =>
      d.id === deductionId ? { ...d, status: DeductionStatus.UNPAID, paid_amount: 0 } : d
    );
    const unpaidBalance = updatedDeductions.reduce((sum, d) => sum + (d.amount - d.paid_amount), 0);

    const { data } = await supabase
      .from('contracts')
      .update({ daily_deductions: updatedDeductions, unpaid_balance: unpaidBalance })
      .eq('id', contractId)
      .select()
      .single();
    if (data) setContracts(prev => prev.map(c => c.id === contractId ? { ...data, unpaid_balance: unpaidBalance } : c));
  };

  // 일차감: 고소건 지정/해제
  const handleToggleLawsuit = async (contractId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !supabase) return;

    const newValue = !contract.is_lawsuit;
    await supabase.from('contracts').update({ is_lawsuit: newValue }).eq('id', contractId);
    setContracts(prev => prev.map(c => c.id === contractId ? { ...c, is_lawsuit: newValue } : c));
  };

  // 일차감: 체크박스 선택 후 일괄 전액 처리
  const handleBulkSettleDeductions = async (contractId: string, deductionIds: string[]) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !supabase) return;

    const idSet = new Set(deductionIds);
    const updatedDeductions = (contract.daily_deductions || []).map(d =>
      idSet.has(d.id) && d.status !== DeductionStatus.PAID
        ? { ...d, status: DeductionStatus.PAID, paid_amount: d.amount }
        : d
    );
    const unpaidBalance = updatedDeductions.reduce((sum, d) => sum + (d.amount - d.paid_amount), 0);

    const { data } = await supabase
      .from('contracts')
      .update({ daily_deductions: updatedDeductions, unpaid_balance: unpaidBalance })
      .eq('id', contractId)
      .select()
      .single();
    if (data) setContracts(prev => prev.map(c => c.id === contractId ? { ...data, unpaid_balance: unpaidBalance } : c));
  };

  // 채권사 정산 핸들러
  const handleSaveCreditorSettlement = async (data: Omit<CreditorSettlementRound, 'id' | 'created_at'> & { id?: string }) => {
    if (!supabase) return;
    if (data.id) {
      const { data: updated } = await supabase.from('creditor_settlements').update({
        settlement_round: data.settlement_round, start_date: data.start_date, end_date: data.end_date,
        creditor_id: data.creditor_id, total_daily_deduction_amount: data.total_daily_deduction_amount,
      }).eq('id', data.id).select().single();
      if (updated) setCreditorSettlements(prev => prev.map(s => s.id === updated.id ? updated : s));
    } else {
      const { data: created } = await supabase.from('creditor_settlements').insert({
        settlement_round: data.settlement_round, start_date: data.start_date, end_date: data.end_date,
        creditor_id: data.creditor_id, total_daily_deduction_amount: data.total_daily_deduction_amount,
      }).select().single();
      if (created) setCreditorSettlements(prev => [created, ...prev]);
    }
  };

  const handleDeleteCreditorSettlement = async (id: string) => {
    if (!supabase) return;
    await supabase.from('creditor_settlements').delete().eq('id', id);
    setCreditorSettlements(prev => prev.filter(s => s.id !== id));
  };

  const handleSaveCreditor = async (name: string) => {
    if (!supabase) return;
    const maxOrder = creditors.reduce((max, c) => Math.max(max, c.display_order), 0);
    const { data: created } = await supabase.from('creditors').insert({ name, display_order: maxOrder + 1 }).select().single();
    if (created) setCreditors(prev => [...prev, created]);
  };

  const handleDeleteCreditor = async (id: string) => {
    if (!supabase) return;
    await supabase.from('creditor_settlements').delete().eq('creditor_id', id);
    await supabase.from('creditors').delete().eq('id', id);
    setCreditors(prev => prev.filter(c => c.id !== id));
    setCreditorSettlements(prev => prev.filter(s => s.creditor_id !== id));
  };

  if (!isSupabaseConfigured) return <ConfigurationError />;
  if (!session) return <Login />;

  return (
    <div className="flex h-screen bg-slate-900 text-white overflow-hidden font-sans">
      <Sidebar 
        currentView={currentView} 
        onNavigate={setCurrentView} 
        onLogout={() => supabase!.auth.signOut()} 
      />
      <main className="flex-1 ml-64 overflow-y-auto h-full bg-slate-900">
        <ErrorBoundary>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-indigo-500"></div>
            </div>
          ) : (
            <>
              {currentView === 'dashboard' && <Dashboard contracts={contracts} partners={partners} />}
              {currentView === 'contractManagement' && <ContractManagement contracts={contracts} partners={partners} onSelectContract={()=>{}} onAddContract={() => {}} onImportContracts={async () => {}} />}
              {currentView === 'collectionManagement' && <CollectionManagement contracts={contracts} partners={partners} />}
              {currentView === 'deductionManagement' && <DeductionManagement contracts={contracts} partners={partners} onAddPayment={handleAddPayment} onSettleDeduction={handleSettleDeduction} onCancelDeduction={handleCancelDeduction} onToggleLawsuit={handleToggleLawsuit} onBulkSettleDeductions={handleBulkSettleDeductions} />}
              {currentView === 'shippingManagement' && <ShippingManagement contracts={contracts} partners={partners} onSelectContract={()=>{}} />}
              {currentView === 'settlementManagement' && <SettlementManagement contracts={contracts} partners={partners} onSelectContract={()=>{}} onRequestSettlement={()=>{}} onCompleteSettlement={()=>{}} onUpdatePrerequisites={()=>{}} onBulkRequestSettlement={()=>{}} onBulkCompleteSettlement={()=>{}} />}
              {currentView === 'creditorSettlementData' && <CreditorSettlementData contracts={contracts} />}
              {currentView === 'creditorBatch' && <CreditorBatch contracts={contracts} />}
              {currentView === 'documentStatus' && <DocumentStatus partners={partners} contracts={contracts} onContractCreated={() => fetchData()} />}
              {currentView === 'contractDocGenerator' && <ContractDocGenerator />}
              {currentView === 'creditorSettlement' && <CreditorSettlement contracts={contracts} creditors={creditors} settlements={creditorSettlements} onSaveSettlement={handleSaveCreditorSettlement} onDeleteSettlement={handleDeleteCreditorSettlement} onSaveCreditor={handleSaveCreditor} onDeleteCreditor={handleDeleteCreditor} />}
              {currentView === 'privacyMasking' && <PrivacyMasking />}
              {currentView === 'partners' && <PartnersManagement partners={partners} onSelectPartner={()=>{}} onAddPartner={() => {}} onAddTemplate={() => {}} />}
              {currentView === 'calendar' && <Calendar events={events} onAddEvent={()=>{}} onEditEvent={()=>{}} />}
              {currentView === 'database' && <DatabaseManagement />}
            </>
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
};

export default AppRouter;