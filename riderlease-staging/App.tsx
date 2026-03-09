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
import { PartnersManagement } from './components/PartnersManagement';
import { Calendar } from './components/Calendar';
import { DatabaseManagement } from './components/DatabaseManagement';
import { GreenwichSettlement } from './components/GreenwichSettlement';
import { PrivacyMasking } from './components/PrivacyMasking';
import { ErrorBoundary } from './components/ErrorBoundary';

import { ContractFormModal } from './ContractFormModal';
import ContractDetailModal from './components/ContractDetailModal';
import { PartnerFormModal } from './components/PartnerFormModal';
import { PartnerDetailModal } from './components/PartnerDetailModal';
import { EventFormModal } from './components/EventFormModal';

import { Contract, Partner, CalendarEvent, GreenwichSettlement as IGreenwichSettlement } from './types';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [greenwichSettlements, setGreenwichSettlements] = useState<IGreenwichSettlement[]>([]);
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
      const [contractsRes, partnersRes, eventsRes, greenwichRes] = await Promise.all([
        supabase.from('contracts').select('*').order('created_at', { ascending: false }),
        supabase.from('partners').select('*').order('created_at', { ascending: false }),
        supabase.from('events').select('*').order('date', { ascending: true }),
        supabase.from('greenwich_settlements').select('*').order('settlement_round', { ascending: false })
      ]);

      if (contractsRes.data) setContracts(contractsRes.data as any);
      if (partnersRes.data) setPartners(partnersRes.data);
      if (eventsRes.data) setEvents(eventsRes.data);
      if (greenwichRes.data) setGreenwichSettlements(greenwichRes.data);
    } catch (e) {
      console.error("Data Fetch Error:", e);
    } finally {
      setLoading(false);
    }
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
              {currentView === 'deductionManagement' && <DeductionManagement contracts={contracts} partners={partners} onAddPayment={()=>{}} onSettleDeduction={()=>{}} onCancelDeduction={()=>{}} />}
              {currentView === 'shippingManagement' && <ShippingManagement contracts={contracts} partners={partners} onSelectContract={()=>{}} />}
              {currentView === 'settlementManagement' && <SettlementManagement contracts={contracts} partners={partners} onSelectContract={()=>{}} onRequestSettlement={()=>{}} onCompleteSettlement={()=>{}} onUpdatePrerequisites={()=>{}} onBulkRequestSettlement={()=>{}} onBulkCompleteSettlement={()=>{}} />}
              {currentView === 'creditorSettlementData' && <CreditorSettlementData contracts={contracts} />}
              {currentView === 'greenwichSettlement' && <GreenwichSettlement contracts={contracts} settlements={greenwichSettlements} onSave={()=>{}} onDelete={()=>{}} />}
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

export default App;