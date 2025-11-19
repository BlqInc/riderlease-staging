
import React, { useState, useEffect, useCallback } from 'react';
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
import { ErrorBoundary } from './components/ErrorBoundary';

import { ContractFormModal } from './components/ContractFormModal';
import ContractDetailModal from './components/ContractDetailModal';

import { PartnerFormModal } from './components/PartnerFormModal';
import { PartnerDetailModal } from './components/PartnerDetailModal';
import { EventFormModal } from './components/EventFormModal';

import { Contract, Partner, CalendarEvent, GreenwichSettlement as IGreenwichSettlement, DeductionStatus, PriceTier } from './types';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  
  // Data States
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [greenwichSettlements, setGreenwichSettlements] = useState<IGreenwichSettlement[]>([]);
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

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const initializeSession = async () => {
      try {
        const { data: { session } } = await supabase!.auth.getSession();
        setSession(session);
        if (session) {
          await fetchData(); // Wait for data before turning off loading
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error("Session initialization error:", error);
        setLoading(false);
      }
    };

    initializeSession();

    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
         fetchData();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const processContracts = (data: any[]): Contract[] => {
    if (!Array.isArray(data)) return [];
    return data.map(c => {
      // Ensure all numbers are actually numbers and not NaN
      const units = (c.units_required && !isNaN(Number(c.units_required))) ? Number(c.units_required) : 1;
      const rawTotalAmount = (c.total_amount && !isNaN(Number(c.total_amount))) ? Number(c.total_amount) : 0;
      const rawDailyDeduction = (c.daily_deduction && !isNaN(Number(c.daily_deduction))) ? Number(c.daily_deduction) : 0;
      
      const total_amount = rawTotalAmount * units;
      const daily_deduction = rawDailyDeduction * units;

      // Calculate unpaid balance from deductions
      const daily_deductions = Array.isArray(c.daily_deductions) ? c.daily_deductions : [];
      const unpaid_balance = daily_deductions.reduce((sum: number, d: any) => {
        const dAmount = (d.amount && !isNaN(Number(d.amount))) ? Number(d.amount) : 0;
        const dPaid = (d.paid_amount && !isNaN(Number(d.paid_amount))) ? Number(d.paid_amount) : 0;
        return sum + (dAmount - dPaid);
      }, 0);
      
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
        daily_deductions: daily_deductions
      };
    });
  };

  const fetchData = async () => {
    if (!supabase) return;
    setLoading(true);
    setFetchError(null);
    
    try {
        const [contractsRes, partnersRes, eventsRes, greenwichRes] = await Promise.all([
            supabase.from('contracts').select('*').order('created_at', { ascending: false }),
            supabase.from('partners').select('*').order('created_at', { ascending: false }),
            supabase.from('events').select('*').order('date', { ascending: true }),
            supabase.from('greenwich_settlements').select('*').order('settlement_round', { ascending: false })
        ]);

        if (contractsRes.error) throw new Error(`계약 데이터 로드 실패: ${contractsRes.error.message}`);
        if (partnersRes.error) throw new Error(`파트너 데이터 로드 실패: ${partnersRes.error.message}`);
        if (eventsRes.error) throw new Error(`일정 데이터 로드 실패: ${eventsRes.error.message}`);
        if (greenwichRes.error) throw new Error(`정산 데이터 로드 실패: ${greenwichRes.error.message}`);

        setContracts(processContracts(contractsRes.data || []));
        setPartners(partnersRes.data || []);
        setEvents(eventsRes.data || []);
        setGreenwichSettlements(greenwichRes.data || []);

    } catch (error: any) {
        console.error('Error fetching data:', error);
        setFetchError(error.message || '데이터를 불러오는 중 알 수 없는 오류가 발생했습니다.');
    } finally {
        setLoading(false);
    }
  };

  // --- Contract Handlers ---
  
  const handleSaveContract = async (contractData: any) => {
      if (!supabase) return;
      
      const { id, unpaid_balance, daily_deductions, ...dataToSave } = contractData;

      try {
          if (id) {
              const { error } = await (supabase.from('contracts') as any).update(dataToSave).eq('id', id);
              if (error) throw error;
          } else {
              const maxNumber = contracts.reduce((max, c) => Math.max(max, c.contract_number || 0), 0);
              const { error } = await (supabase.from('contracts') as any).insert({ ...dataToSave, contract_number: maxNumber + 1 });
              if (error) throw error;
          }
          fetchData();
          setIsContractFormOpen(false);
          setEditingContract(null);
          setContractFormTemplate(null);
      } catch (error: any) {
          console.error('Error saving contract:', error);
          alert(`계약 저장 실패: ${error.message}`);
      }
  };

  const handleDeleteContract = async (id: string) => {
      if (!supabase) return;
      try {
          const { error } = await supabase.from('contracts').delete().eq('id', id);
          if (error) throw error;
          fetchData();
          setSelectedContract(null);
      } catch (error: any) {
          console.error('Error deleting contract:', error);
          alert(`계약 삭제 실패: ${error.message}`);
      }
  };
  
  const handleImportContracts = async (newContracts: any[]) => {
      if (!supabase) return;
      
      let currentMaxNumber = contracts.reduce((max, c) => Math.max(max, c.contract_number || 0), 0);

      const contractsWithNumbers = newContracts.map(c => {
          currentMaxNumber += 1;
          return { ...c, contract_number: currentMaxNumber };
      });

      try {
          const { error } = await (supabase.from('contracts') as any).insert(contractsWithNumbers);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          console.error('Error importing contracts:', error);
          throw error;
      }
  };

  // --- Partner Handlers ---

  const handleSavePartner = async (partnerData: any) => {
      if (!supabase) return;
      const { id, ...dataToSave } = partnerData;
      try {
          if (id) {
              const { error } = await (supabase.from('partners') as any).update(dataToSave).eq('id', id);
              if (error) throw error;
          } else {
              const { error } = await (supabase.from('partners') as any).insert(dataToSave);
              if (error) throw error;
          }
          fetchData();
          setIsPartnerFormOpen(false);
          setEditingPartner(null);
      } catch (error: any) {
          console.error('Error saving partner:', error);
          alert(`파트너 저장 실패: ${error.message}`);
      }
  };

  const handleDeletePartner = async (id: string) => {
       if (!supabase) return;
      try {
          const { error } = await supabase.from('partners').delete().eq('id', id);
          if (error) throw error;
          fetchData();
          setSelectedPartnerId(null);
      } catch (error: any) {
          console.error('Error deleting partner:', error);
          alert(`파트너 삭제 실패: ${error.message}`);
      }
  };

  const handleUpdatePriceTier = async (partnerId: string, priceTierId: string, data: Partial<PriceTier>) => {
      const partner = partners.find(p => p.id === partnerId);
      if (!partner || !partner.price_list) return;
      
      const newPriceList = partner.price_list.map(p => p.id === priceTierId ? { ...p, ...data } : p);
      await handleSavePartner({ id: partnerId, price_list: newPriceList });
  };

  const handleDeletePriceTier = async (partnerId: string, priceTierId: string) => {
      const partner = partners.find(p => p.id === partnerId);
      if (!partner || !partner.price_list) return;

      const newPriceList = partner.price_list.filter(p => p.id !== priceTierId);
      await handleSavePartner({ id: partnerId, price_list: newPriceList });
  };
  
  const handleAddPriceTier = async (partnerId: string, tierData: Omit<PriceTier, 'id'>) => {
       const partner = partners.find(p => p.id === partnerId);
      if (!partner) return;
      
      const newTier = { ...tierData, id: `pt-${Date.now()}` };
      const newPriceList = [...(partner.price_list || []), newTier];
      await handleSavePartner({ id: partnerId, price_list: newPriceList });
  };

  const handleAddPriceTiersFromMaster = async (partnerId: string, tiers: PriceTier[]) => {
       const partner = partners.find(p => p.id === partnerId);
      if (!partner) return;
      
      const newTiers = tiers.map(t => ({ ...t, id: `pt-${Date.now()}-${Math.random().toString(36).substr(2,9)}` }));
      const newPriceList = [...(partner.price_list || []), ...newTiers];
      await handleSavePartner({ id: partnerId, price_list: newPriceList });
  };

  // --- Event Handlers ---
  
  const handleSaveEvent = async (eventData: any) => {
      if (!supabase) return;
      const { id, ...dataToSave } = eventData;
      try {
          if (id) {
              const { error } = await (supabase.from('events') as any).update(dataToSave).eq('id', id);
              if (error) throw error;
          } else {
              const { error } = await (supabase.from('events') as any).insert(dataToSave);
              if (error) throw error;
          }
          fetchData();
          setIsEventFormOpen(false);
          setEditingEvent(null);
      } catch (error: any) {
           console.error('Error saving event:', error);
          alert(`일정 저장 실패: ${error.message}`);
      }
  };

  const handleDeleteEvent = async (id: string) => {
      if (!supabase) return;
       try {
          const { error } = await supabase.from('events').delete().eq('id', id);
          if (error) throw error;
          fetchData();
          setIsEventFormOpen(false);
          setEditingEvent(null);
      } catch (error: any) {
           console.error('Error deleting event:', error);
          alert(`일정 삭제 실패: ${error.message}`);
      }
  };

  // --- Deduction/Settlement Logic ---

  const handleAddPayment = async (contractId: string, amount: number) => {
      if (!supabase) return;
      const contract = contracts.find(c => c.id === contractId);
      if (!contract || !contract.daily_deductions) return;

      let remainingAmount = amount;
      // Process oldest unpaid deductions first
      const sortedDeductions = [...contract.daily_deductions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      const updatedDeductions = sortedDeductions.map(d => {
          if (remainingAmount <= 0) return d;
          if (d.status === DeductionStatus.PAID) return d;

          const unpaidPortion = d.amount - d.paid_amount;
          const paymentForThis = Math.min(remainingAmount, unpaidPortion);
          
          d.paid_amount += paymentForThis;
          remainingAmount -= paymentForThis;
          
          if (d.paid_amount >= d.amount) {
              d.status = DeductionStatus.PAID;
          } else if (d.paid_amount > 0) {
              d.status = DeductionStatus.PARTIAL;
          }
          return d;
      });

      try {
          const { error } = await (supabase.from('contracts') as any).update({ daily_deductions: updatedDeductions }).eq('id', contractId);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          alert(`입금 처리 실패: ${error.message}`);
      }
  };

  const handleSettleDeduction = async (contractId: string, deductionId: string) => {
       if (!supabase) return;
      const contract = contracts.find(c => c.id === contractId);
      if (!contract || !contract.daily_deductions) return;

      const updatedDeductions = contract.daily_deductions.map(d => {
          if (d.id === deductionId) {
              return { ...d, paid_amount: d.amount, status: DeductionStatus.PAID };
          }
          return d;
      });
       try {
          const { error } = await (supabase.from('contracts') as any).update({ daily_deductions: updatedDeductions }).eq('id', contractId);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          alert(`처리 실패: ${error.message}`);
      }
  };

  const handleCancelDeduction = async (contractId: string, deductionId: string) => {
       if (!supabase) return;
      const contract = contracts.find(c => c.id === contractId);
      if (!contract || !contract.daily_deductions) return;

      const updatedDeductions = contract.daily_deductions.map(d => {
          if (d.id === deductionId) {
              return { ...d, paid_amount: 0, status: DeductionStatus.UNPAID };
          }
          return d;
      });
      try {
          const { error } = await (supabase.from('contracts') as any).update({ daily_deductions: updatedDeductions }).eq('id', contractId);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          alert(`취소 실패: ${error.message}`);
      }
  };

  const handleUpdatePrerequisites = async (contractId: string, updates: any) => {
       if (!supabase) return;
       try {
          const { error } = await (supabase.from('contracts') as any).update(updates).eq('id', contractId);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          alert(`업데이트 실패: ${error.message}`);
      }
  };

  const handleRequestSettlement = async (contractId: string) => {
       if (!supabase) return;
       try {
           // Set status to REQUESTED and set requested_date
          const { error } = await (supabase.from('contracts') as any).update({ 
              settlement_status: '정산 요청됨',
              settlement_request_date: new Date().toISOString()
           }).eq('id', contractId);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          alert(`요청 실패: ${error.message}`);
      }
  };
  
  const handleCompleteSettlement = async (contractId: string) => {
       if (!supabase) return;
       try {
          const { error } = await (supabase.from('contracts') as any).update({ 
              settlement_status: '정산 완료',
              status: '정산완료',
              settlement_date: new Date().toISOString()
           }).eq('id', contractId);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          alert(`완료 처리 실패: ${error.message}`);
      }
  };
  
  const handleBulkRequestSettlement = async (ids: string[]) => {
       if (!supabase) return;
       try {
          const { error } = await (supabase.from('contracts') as any).update({ 
              settlement_status: '정산 요청됨',
              settlement_request_date: new Date().toISOString()
           }).in('id', ids);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          alert(`일괄 요청 실패: ${error.message}`);
      }
  };

  const handleBulkCompleteSettlement = async (ids: string[]) => {
      if (!supabase) return;
       try {
          const { error } = await (supabase.from('contracts') as any).update({ 
              settlement_status: '정산 완료',
              status: '정산완료',
              settlement_date: new Date().toISOString()
           }).in('id', ids);
          if (error) throw error;
          fetchData();
      } catch (error: any) {
          alert(`일괄 완료 실패: ${error.message}`);
      }
  };

  // --- Greenwich Settlement Handlers ---

  const handleSaveGreenwichSettlement = async (data: any) => {
      if (!supabase) return;
      const { id, ...dataToSave } = data;
      try {
          if (id) {
               const { error } = await (supabase.from('greenwich_settlements') as any).update(dataToSave).eq('id', id);
               if (error) throw error;
          } else {
               const { error } = await (supabase.from('greenwich_settlements') as any).insert(dataToSave);
               if (error) throw error;
          }
          fetchData();
      } catch (error: any) {
          alert(`저장 실패: ${error.message}`);
      }
  };

  const handleDeleteGreenwichSettlement = async (id: string) => {
       if (!supabase) return;
       try {
           const { error } = await supabase.from('greenwich_settlements').delete().eq('id', id);
           if (error) throw error;
           fetchData();
      } catch (error: any) {
          alert(`삭제 실패: ${error.message}`);
      }
  };

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
                            onClick={fetchData}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                        >
                            다시 시도
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    {currentView === 'dashboard' && <Dashboard contracts={contracts} partners={partners} />}
                    {currentView === 'contractManagement' && (
                      <ContractManagement
                        contracts={contracts}
                        partners={partners}
                        onSelectContract={(c) => { setSelectedContract(c); }}
                        onAddContract={(template) => { 
                            setEditingContract(null); 
                            setContractFormTemplate(template || null);
                            setIsContractFormOpen(true); 
                        }}
                        onImportContracts={handleImportContracts}
                      />
                    )}
                    {currentView === 'deductionManagement' && (
                        <DeductionManagement 
                            contracts={contracts}
                            partners={partners}
                            onAddPayment={handleAddPayment}
                            onSettleDeduction={handleSettleDeduction}
                            onCancelDeduction={handleCancelDeduction}
                        />
                    )}
                    {currentView === 'shippingManagement' && (
                        <ShippingManagement contracts={contracts} partners={partners} onSelectContract={setSelectedContract} />
                    )}
                    {currentView === 'settlementManagement' && (
                        <SettlementManagement 
                            contracts={contracts} 
                            partners={partners} 
                            onSelectContract={setSelectedContract}
                            onRequestSettlement={handleRequestSettlement}
                            onCompleteSettlement={handleCompleteSettlement}
                            onUpdatePrerequisites={handleUpdatePrerequisites}
                            onBulkRequestSettlement={handleBulkRequestSettlement}
                            onBulkCompleteSettlement={handleBulkCompleteSettlement}
                        />
                    )}
                    {currentView === 'creditorSettlementData' && <CreditorSettlementData contracts={contracts} />}
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
                    {currentView === 'greenwichSettlement' && (
                        <GreenwichSettlement 
                            contracts={contracts} 
                            settlements={greenwichSettlements}
                            onSave={handleSaveGreenwichSettlement}
                            onDelete={handleDeleteGreenwichSettlement}
                        />
                    )}
                </>
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

export default App;
