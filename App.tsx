

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Sidebar, View } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { ContractManagement } from './components/ContractManagement';
import { DeductionManagement } from './components/DeductionManagement';
import { ShippingManagement } from './components/ShippingManagement';
import { SettlementManagement } from './components/SettlementManagement';
import { CreditorSettlementData } from './components/CreditorSettlementData';
import { GreenwichSettlement } from './components/GreenwichSettlement';
import { PartnersManagement } from './components/PartnersManagement';
import ContractDetailModal from './components/ContractDetailModal';
import { ContractFormModal } from './components/ContractFormModal';
import { PartnerDetailModal } from './components/PartnerDetailModal';
import { PartnerFormModal } from './components/PartnerFormModal';
import { Calendar } from './components/Calendar';
import { EventFormModal } from './components/EventFormModal';
import { DatabaseManagement } from './components/DatabaseManagement';
import { ConfigurationError } from './components/ConfigurationError';
import { Contract, Partner, PriceTier, SettlementStatus, CalendarEvent, ContractStatus, DeductionStatus, DailyDeductionLog, ShippingStatus, GreenwichSettlement as IGreenwichSettlement } from './types';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient';

type EditingContractState = Contract | 'new' | null;
type EditingPartnerState = Partner | 'new' | null;
type EditingEventState = Partial<CalendarEvent> | null;

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [greenwichSettlements, setGreenwichSettlements] = useState<IGreenwichSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [editingContract, setEditingContract] = useState<EditingContractState>(null);
  const [newContractTemplate, setNewContractTemplate] = useState<Partial<Contract> | null>(null);

  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [editingPartner, setEditingPartner] = useState<EditingPartnerState>(null);
  const [isNewPartnerTemplate, setIsNewPartnerTemplate] = useState(false);

  const [editingEvent, setEditingEvent] = useState<EditingEventState>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>('');

  const selectedPartner = selectedPartnerId ? partners.find(p => p.id === selectedPartnerId) ?? null : null;
  const priceTemplates = useMemo(() => partners.filter(p => p.is_template), [partners]);

  const processContracts = (rawContracts: any[]): Contract[] => {
      // Use UTC for today's date to ensure consistent comparisons across timezones
      const localToday = new Date();
      const today = new Date(Date.UTC(localToday.getUTCFullYear(), localToday.getUTCMonth(), localToday.getUTCDate()));

      return rawContracts.map(rawContract => {
          // 원본 데이터는 변경하지 않습니다.
          const units = Number(rawContract.units_required) || 1;
          
          // 총액을 먼저 계산합니다.
          const totalAmount = (Number(rawContract.total_amount) || 0) * units;
          const totalDailyDeduction = (Number(rawContract.daily_deduction) || 0) * units;

          let finalDeductions: DailyDeductionLog[] = [];
          
          if (rawContract.execution_date && rawContract.expiry_date) {
              const existingDeductionsMap = new Map<string, DailyDeductionLog>((rawContract.daily_deductions || []).map(d => [d.date, d]));
              
              const startParts = rawContract.execution_date.split('-').map(Number);
              const startDate = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));

              const expiryParts = rawContract.expiry_date.split('-').map(Number);
              const expiryDate = new Date(Date.UTC(expiryParts[0], expiryParts[1] - 1, expiryParts[2]));
              
              let currentDate = new Date(startDate.getTime());

              // 만료일과 오늘 날짜 중 더 미래의 날짜까지 루프를 돕니다.
              const loopEndDate = today.getTime() > expiryDate.getTime() ? today : expiryDate;
              
              while (currentDate <= loopEndDate) {
                  const dateString = currentDate.toISOString().split('T')[0];
                  const existingDeduction = existingDeductionsMap.get(dateString);

                  if (existingDeduction) {
                      // 기존 차감 내역이 있으면 그대로 사용합니다.
                      finalDeductions.push(existingDeduction);
                  } else {
                      // 없으면 새로 생성합니다. amount는 총 일차감액을 사용합니다.
                      finalDeductions.push({
                          id: `${rawContract.id}-${dateString}`,
                          date: dateString,
                          amount: totalDailyDeduction,
                          status: currentDate < today ? DeductionStatus.UNPAID : DeductionStatus.PENDING,
                          paid_amount: 0,
                      });
                  }
                  currentDate.setUTCDate(currentDate.getUTCDate() + 1);
              }
          } else {
              // 실행일 또는 만료일이 없는 경우, 기존 DB 데이터만 사용합니다.
              finalDeductions = rawContract.daily_deductions || [];
          }
          
          // 미납액을 계산합니다.
          const unpaid_balance = finalDeductions
              .filter(d => d.status !== DeductionStatus.PAID)
              .reduce((sum, d) => sum + (d.amount - d.paid_amount), 0);

          // 계약 상태를 업데이트합니다.
          let finalStatus = rawContract.status;
          if (rawContract.status === ContractStatus.ACTIVE && rawContract.expiry_date) {
            const expiryParts = rawContract.expiry_date.split('-').map(Number);
            const expiryDate = new Date(Date.UTC(expiryParts[0], expiryParts[1] - 1, expiryParts[2]));
            if (expiryDate < today) {
                finalStatus = ContractStatus.EXPIRED;
            }
          }
          
          // 정산 상태를 업데이트합니다.
          const isSettlementReady = 
              rawContract.shipping_status === ShippingStatus.DELIVERED &&
              rawContract.is_lessee_contract_signed &&
              !!rawContract.settlement_document_url;
          
          let settlement_status = rawContract.settlement_status;
          if (settlement_status === SettlementStatus.NOT_READY && isSettlementReady) {
              settlement_status = SettlementStatus.READY;
          } else if (settlement_status === SettlementStatus.READY && !isSettlementReady) {
              settlement_status = SettlementStatus.NOT_READY;
          }
          
          // 모든 계산이 끝난 후, 최종적으로 새로운 객체를 만들어 반환합니다.
          return {
              ...rawContract,
              total_amount: totalAmount,
              daily_deduction: totalDailyDeduction,
              daily_deductions: finalDeductions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
              unpaid_balance,
              status: finalStatus,
              settlement_status
          };
      });
  };


  const fetchData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const [
        { data: contractsData, error: contractsError },
        { data: partnersData, error: partnersError },
        { data: eventsData, error: eventsError },
        { data: greenwichData, error: greenwichError },
      ] = await Promise.all([
        supabase.from('contracts').select('*').order('contract_number', { ascending: false }),
        supabase.from('partners').select('*').order('name'),
        supabase.from('events').select('*'),
        supabase.from('greenwich_settlements').select('*').order('settlement_round', { ascending: false }),
      ]);

      if (contractsError) throw new Error(`계약 정보 로딩 실패: ${contractsError.message}`);
      if (partnersError) throw new Error(`파트너 정보 로딩 실패: ${partnersError.message}`);
      if (eventsError) throw new Error(`캘린더 정보 로딩 실패: ${eventsError.message}`);
      if (greenwichError) throw new Error(`그린위치 정산 정보 로딩 실패: ${greenwichError.message}`);
      
      const processedContracts = processContracts(contractsData || []);
      setContracts(processedContracts);
      setPartners(partnersData || []);
      setEvents(eventsData || []);
      setGreenwichSettlements(greenwichData || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- CRUD Handlers ---

  const handleSaveContract = async (data: Omit<Contract, 'unpaid_balance' | 'id' | 'contract_number'> & { id?: string; contract_number?: number; }) => {
    if (!supabase) return;
    try {
      if (data.id) {
        // Update: `contract_number` is not updatable, so we exclude it.
        const { id, contract_number, ...updateData } = data;
        const { error } = await supabase.from('contracts').update(updateData).match({ id });
        if (error) throw error;
      } else {
        // Insert: Generate a new contract number.
        const { data: latestContract, error: latestError } = await supabase
            .from('contracts')
            .select('contract_number')
            .order('contract_number', { ascending: false })
            .limit(1)
            .single();

        if (latestError && latestError.code !== 'PGRST116') throw latestError;
        const lastContractNumber = latestContract ? latestContract.contract_number : 0;
        const insertData = { ...data, contract_number: lastContractNumber + 1 };
        
        const { error } = await supabase.from('contracts').insert(insertData);
        if (error) throw error;
      }
      
      setEditingContract(null);
      await fetchData();
    } catch (err: any) {
      setError(`계약 저장 실패: ${err.message}`);
    }
  };

  const handleDeleteContract = async (contractId: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('contracts').delete().match({ id: contractId });
      if (error) throw error;
      setSelectedContract(null);
      await fetchData();
    } catch (err: any) {
      setError(`계약 삭제 실패: ${err.message}`);
    }
  };
  
  const handleSavePartner = async (data: Omit<Partner, 'id'> & { id?: string }) => {
    if (!supabase) return;
    try {
      if (data.id) {
        const { id, ...updateData } = data;
        const { error } = await supabase.from('partners').update(updateData).match({ id });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('partners').insert(data);
        if (error) throw error;
      }
      setEditingPartner(null);
      await fetchData();
    } catch (err: any) {
      setError(`파트너 저장 실패: ${err.message}`);
    }
  };

  const handleDeletePartner = async (partnerId: string) => {
    if (!supabase) return;
    if (window.confirm('정말 이 파트너사/템플릿을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        try {
            const { error } = await supabase.from('partners').delete().match({ id: partnerId });
            if (error) throw error;
            setSelectedPartnerId(null);
            await fetchData();
        } catch (err: any) {
            setError(`파트너 삭제 실패: ${err.message}`);
        }
    }
  };

  const handlePriceTierUpdate = async (partnerId: string, price_list: PriceTier[] | null) => {
      if (!supabase) return;
      try {
          const { error } = await supabase.from('partners').update({ price_list }).match({ id: partnerId });
          if (error) throw error;
          await fetchData();
      } catch (err: any) {
          setError(`단가표 업데이트 실패: ${err.message}`);
      }
  };

  const handleSaveEvent = async (data: Omit<CalendarEvent, 'id'> & { id?: string }) => {
    if (!supabase) return;
    try {
      if (data.id) {
        const { id, ...updateData } = data;
        const { error } = await supabase.from('events').update(updateData).match({ id });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('events').insert(data);
        if (error) throw error;
      }
      setEditingEvent(null);
      await fetchData();
    } catch (err: any)
{
      setError(`이벤트 저장 실패: ${err.message}`);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('events').delete().match({ id: eventId });
      if (error) throw error;
      setEditingEvent(null);
      await fetchData();
    } catch (err: any) {
      setError(`이벤트 삭제 실패: ${err.message}`);
    }
  };

  const handleSaveGreenwichSettlement = async (data: Omit<IGreenwichSettlement, 'id' | 'created_at'> & { id?: string }) => {
    if (!supabase) return;
    try {
      if (data.id) {
        const { id, ...updateData } = data;
        const { error } = await supabase.from('greenwich_settlements').update(updateData).match({ id });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('greenwich_settlements').insert(data);
        if (error) throw error;
      }
      await fetchData();
    } catch (err: any) {
      setError(`그린위치 정산 저장 실패: ${err.message}`);
    }
  };

  const handleDeleteGreenwichSettlement = async (id: string) => {
    if (!supabase) return;
    if (window.confirm('정말 이 정산 차수를 삭제하시겠습니까?')) {
        try {
            const { error } = await supabase.from('greenwich_settlements').delete().match({ id });
            if (error) throw error;
            await fetchData();
        } catch (err: any) {
            setError(`그린위치 정산 삭제 실패: ${err.message}`);
        }
    }
  };
  
  const handleUpdateContractField = async (contractId: string, updates: Partial<Omit<Contract, 'id' | 'contract_number' | 'unpaid_balance'>>) => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('contracts').update(updates).match({ id: contractId });
      if (error) throw error;
      await fetchData();
      return true;
    } catch (err: any) {
      setError(`계약 업데이트 실패: ${err.message}`);
      return false;
    }
  };

  const handleAddPayment = async (contractId: string, amount: number) => {
      const contract = contracts.find(c => c.id === contractId);
      if (!contract || !contract.daily_deductions) return;

      let remainingAmount = amount;
      const updatedDeductions = contract.daily_deductions.map(d => {
          if (remainingAmount <= 0 || d.status === DeductionStatus.PAID) {
              return d;
          }

          const needed = d.amount - d.paid_amount;
          const payment = Math.min(needed, remainingAmount);
          
          const newPaidAmount = d.paid_amount + payment;
          remainingAmount -= payment;

          const newStatus = newPaidAmount >= d.amount ? DeductionStatus.PAID : DeductionStatus.PARTIAL;

          return { ...d, paid_amount: newPaidAmount, status: newStatus };
      });
      
      await handleUpdateContractField(contractId, { daily_deductions: updatedDeductions });
  };
  
  const handleSettleDeduction = async (contractId: string, deductionId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.daily_deductions) return;

    const updatedDeductions = contract.daily_deductions.map(d => {
        if (d.id === deductionId) {
            return { ...d, status: DeductionStatus.PAID, paid_amount: d.amount };
        }
        return d;
    });
    await handleUpdateContractField(contractId, { daily_deductions: updatedDeductions });
  };
  
  const handleCancelDeduction = async (contractId: string, deductionId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract || !contract.daily_deductions) return;

    const localToday = new Date();
    const today = new Date(Date.UTC(localToday.getUTCFullYear(), localToday.getUTCMonth(), localToday.getUTCDate()));

    const updatedDeductions = contract.daily_deductions.map(d => {
        if (d.id === deductionId) {
            const deductionDateParts = d.date.split('-').map(Number);
            const deductionDate = new Date(Date.UTC(deductionDateParts[0], deductionDateParts[1] - 1, deductionDateParts[2]));
            const newStatus = deductionDate < today ? DeductionStatus.UNPAID : DeductionStatus.PENDING;
            return { ...d, status: newStatus, paid_amount: 0 };
        }
        return d;
    });
     await handleUpdateContractField(contractId, { daily_deductions: updatedDeductions });
  };
  
  const handleBulkUpdate = async (updates: ({ id: string; } & Partial<Omit<Contract, 'id' | 'contract_number' | 'unpaid_balance'>>) []) => {
      if (!supabase) return;
      try {
          const updatePromises = updates.map(u => {
              const { id, ...updateData } = u;
              return supabase.from('contracts').update(updateData).match({ id });
          });
          const results = await Promise.all(updatePromises);
          for (const result of results) {
              if (result.error) throw result.error;
          }
          await fetchData();
      } catch (err: any) {
          setError(`일괄 업데이트 실패: ${err.message}`);
      }
  };


  if (!isSupabaseConfigured) {
    return <ConfigurationError />;
  }

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200">
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />
      <main className="flex-1 ml-64 overflow-y-auto">
        {loading && <div className="p-8 text-center text-lg animate-pulse">데이터를 불러오는 중입니다...</div>}
        {error && <div className="p-8 m-8 bg-red-900/50 border border-red-700 text-red-300 rounded-lg">{error}</div>}
        {!loading && !error && (
          <>
            {currentView === 'dashboard' && <Dashboard contracts={contracts} />}
            {currentView === 'contractManagement' && (
              <ContractManagement
                contracts={contracts}
                partners={partners}
                onSelectContract={setSelectedContract}
                onAddContract={(template) => {
                  setNewContractTemplate(template ?? null);
                  setEditingContract('new');
                }}
                onImportContracts={async (newContracts) => {
                  if (!supabase) return;
                  const { data: latestContract, error: latestError } = await supabase.from('contracts').select('contract_number').order('contract_number', { ascending: false }).limit(1).single();
                  if (latestError && latestError.code !== 'PGRST116') throw new Error(`Import failed: ${latestError.message}`);
                  
                  const lastContractNumber = latestContract ? latestContract.contract_number : 0;
                  let nextContractNumber = lastContractNumber + 1;
                  
                  const contractsToInsert = newContracts.map(c => ({...c, contract_number: nextContractNumber++}));
                  
                  const { error } = await supabase.from('contracts').insert(contractsToInsert as any);
                  if (error) throw new Error(`Import failed: ${error.message}`);
                  await fetchData();
                }}
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
                <ShippingManagement 
                    contracts={contracts}
                    partners={partners}
                    onSelectContract={setSelectedContract}
                />
            )}
            {currentView === 'settlementManagement' && (
                <SettlementManagement 
                    contracts={contracts}
                    partners={partners}
                    onSelectContract={setSelectedContract}
                    onRequestSettlement={(id) => handleUpdateContractField(id, { settlement_status: SettlementStatus.REQUESTED, settlement_request_date: new Date().toISOString() })}
                    onCompleteSettlement={(id) => handleUpdateContractField(id, { settlement_status: SettlementStatus.COMPLETED, settlement_date: new Date().toISOString() })}
                    onUpdatePrerequisites={(id, updates) => handleUpdateContractField(id, updates)}
                    onBulkRequestSettlement={(ids) => handleBulkUpdate(ids.map(id => ({ id, settlement_status: SettlementStatus.REQUESTED, settlement_request_date: new Date().toISOString() })))}
                    onBulkCompleteSettlement={(ids) => handleBulkUpdate(ids.map(id => ({ id, settlement_status: SettlementStatus.COMPLETED, settlement_date: new Date().toISOString() })))}
                />
            )}
            {currentView === 'creditorSettlementData' && <CreditorSettlementData contracts={contracts} />}
            {currentView === 'greenwichSettlement' && (
              <GreenwichSettlement
                contracts={contracts}
                settlements={greenwichSettlements}
                onSave={handleSaveGreenwichSettlement}
                onDelete={handleDeleteGreenwichSettlement}
              />
            )}
            {currentView === 'partners' && (
                <PartnersManagement
                    partners={partners}
                    onSelectPartner={setSelectedPartnerId}
                    onAddPartner={() => { setIsNewPartnerTemplate(false); setEditingPartner('new'); }}
                    onAddTemplate={() => { setIsNewPartnerTemplate(true); setEditingPartner('new'); }}
                />
            )}
            {currentView === 'calendar' && (
                <Calendar 
                    events={events}
                    onAddEvent={(date) => { setSelectedCalendarDate(date); setEditingEvent({}); }}
                    onEditEvent={setEditingEvent}
                />
            )}
            {currentView === 'database' && <DatabaseManagement />}
          </>
        )}
      </main>

      {/* --- Modals --- */}
      {selectedContract && (
        <ContractDetailModal
          contract={selectedContract}
          partner={partners.find(p => p.id === selectedContract.partner_id) || null}
          onClose={() => setSelectedContract(null)}
          onEdit={(c) => { setSelectedContract(null); setEditingContract(c); }}
          onDelete={handleDeleteContract}
          onDuplicate={(c) => {
              const { id, contract_number, daily_deductions, ...template } = c;
              // When duplicating, we must revert to per-unit pricing for the form template.
              // 'c' is a processed contract, so its amounts are total values.
              const units = c.units_required || 1;
              
              template.total_amount = (c.total_amount || 0) / units;
              template.daily_deduction = (c.daily_deduction || 0) / units;

              setNewContractTemplate(template);
              setSelectedContract(null);
              setEditingContract('new');
          }}
        />
      )}
      {editingContract && (
        <ContractFormModal
          isOpen={!!editingContract}
          onClose={() => setEditingContract(null)}
          onSave={handleSaveContract}
          partners={partners.filter(p => !p.is_template)}
          contractToEdit={editingContract === 'new' ? null : editingContract}
          template={editingContract === 'new' ? newContractTemplate : null}
        />
      )}
      {selectedPartner && (
        <PartnerDetailModal
            partner={selectedPartner}
            priceTemplates={priceTemplates}
            onClose={() => setSelectedPartnerId(null)}
            onEdit={(p) => { setSelectedPartnerId(null); setEditingPartner(p); }}
            onDelete={handleDeletePartner}
            onAddPriceTier={(partnerId, tier) => {
                const p = partners.find(p => p.id === partnerId);
                if (!p) return;
                const newTier = { ...tier, id: `pt-${Date.now()}` };
                const updatedPriceList = [...(p.price_list || []), newTier];
                handlePriceTierUpdate(partnerId, updatedPriceList);
            }}
            onUpdatePriceTier={(partnerId, tierId, data) => {
                const p = partners.find(p => p.id === partnerId);
                if (!p || !p.price_list) return;
                const updatedPriceList = p.price_list.map(t => t.id === tierId ? { ...t, ...data } : t);
                handlePriceTierUpdate(partnerId, updatedPriceList);
            }}
            onDeletePriceTier={(partnerId, tierId) => {
                 const p = partners.find(p => p.id === partnerId);
                 if (!p || !p.price_list) return;
                 const updatedPriceList = p.price_list.filter(t => t.id !== tierId);
                 handlePriceTierUpdate(partnerId, updatedPriceList);
            }}
            onAddPriceTiersFromMaster={(partnerId, tiers) => {
                const p = partners.find(p => p.id === partnerId);
                if (!p) return;
                const newTiers = tiers.map(t => ({ ...t, id: `pt-${Date.now()}-${Math.random()}`}));
                const updatedPriceList = [...(p.price_list || []), ...newTiers];
                handlePriceTierUpdate(partnerId, updatedPriceList);
            }}
        />
      )}
      {editingPartner && (
        <PartnerFormModal
            isOpen={!!editingPartner}
            onClose={() => setEditingPartner(null)}
            onSave={handleSavePartner}
            partnerToEdit={editingPartner === 'new' ? null : editingPartner}
            isTemplate={isNewPartnerTemplate}
        />
      )}
      {editingEvent && (
        <EventFormModal
          isOpen={!!editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          eventToEdit={editingEvent}
          selectedDate={selectedCalendarDate}
        />
      )}
    </div>
  );
};

export default App;