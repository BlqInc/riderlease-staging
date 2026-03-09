

import React, { useState, useEffect, useMemo } from 'react';
import { Contract, Partner, ContractStatus, ShippingStatus, PriceTier, ProcurementStatus, SettlementStatus } from '../types';
import { CloseIcon } from './icons/IconComponents';
import { formatCurrency } from '../lib/utils';

interface ContractFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (contract: Omit<Contract, 'unpaid_balance' | 'id' | 'contract_number'> & { id?: string; contract_number?: number; }) => void;
  partners: Partner[];
  contractToEdit: Contract | null;
  template?: Partial<Contract> | null;
}

type FormState = Omit<Contract, 'unpaid_balance' | 'device_name' | 'id' | 'contract_number'> & {
  id?: string;
  contract_number?: number;
  model: string;
  storage: string;
};

const initialFormState: FormState = {
  partner_id: '',
  model: '',
  storage: '',
  color: '',
  contract_date: new Date().toISOString().split('T')[0],
  expiry_date: '',
  duration_days: 0,
  total_amount: 0,
  daily_deduction: 0,
  daily_deductions: null,
  contract_initial_deduction: null,
  status: ContractStatus.ACTIVE,
  is_lessee_contract_signed: false,
  shipping_status: ShippingStatus.PREPARING,
  procurement_status: ProcurementStatus.UNSECURED,
  units_required: 1,
  units_secured: 0,
  settlement_round: null,
  execution_date: null,
  shipping_date: null,
  shipping_company: null,
  tracking_number: null,
  settlement_date: null,
  manager_name: null,
  lessee_name: null,
  lessee_contact: null,
  lessee_business_number: null,
  lessee_business_address: null,
  distributor_name: null,
  distributor_contact: null,
  distributor_business_number: null,
  distributor_address: null,
  contract_file_url: null,
  procurement_source: null,
  procurement_cost: null,
  delivery_method_to_lessee: null,
  settlement_request_date: null,
  settlement_status: SettlementStatus.NOT_READY,
  settlement_document_url: null,
};

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="bg-slate-900/50 p-4 rounded-lg">
        <h3 className="font-bold text-white mb-3 text-lg">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {children}
        </div>
    </div>
);

const FormField: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
    <div className={className}>
        <label className="block text-sm font-medium text-slate-400 mb-1">{label}</label>
        {children}
    </div>
);

export const ContractFormModal: React.FC<ContractFormModalProps> = ({ isOpen, onClose, onSave, partners, contractToEdit, template }) => {
  const [formState, setFormState] = useState<FormState>(initialFormState);

  const selectedPartner = useMemo(() => partners.find(p => p.id === formState.partner_id), [partners, formState.partner_id]);
  
  const availableModels = useMemo(() => {
    if (!selectedPartner?.price_list) return [];
    return [...new Set(selectedPartner.price_list.map(p => p.model))];
  }, [selectedPartner]);

  const availableStorages = useMemo(() => {
    if (!selectedPartner?.price_list || !formState.model) return [];
    const storages = selectedPartner.price_list
      .filter(p => p.model === formState.model)
      .map(p => p.storage);
    return [...new Set(storages)];
  }, [selectedPartner, formState.model]);
  
  const availableDurations = useMemo(() => {
    if (!selectedPartner?.price_list || !formState.model || !formState.storage) return [];
    return selectedPartner.price_list
      .filter(p => p.model === formState.model && p.storage === formState.storage)
      .map(p => p.duration_days);
  }, [selectedPartner, formState.model, formState.storage]);


  useEffect(() => {
    if (isOpen) {
        if (contractToEdit) {
            const partner = partners.find(p => p.id === contractToEdit.partner_id);
            const deviceName = contractToEdit.device_name || '';
            let model = '';
            let storage = '';
            
            // NOTE: The contract object from props contains total amounts.
            // We need to divide by units to show the per-unit price in the form.
            const units = contractToEdit.units_required || 1;
            const perUnitTotalAmount = (contractToEdit.total_amount || 0) / units;
            const perUnitDailyDeduction = (contractToEdit.daily_deduction || 0) / units;

            if (partner && partner.price_list) {
                // FIX: Explicitly set the return type of the map function callback to 'string'. This resolves a type inference
                // issue where the array was being incorrectly typed as 'unknown[]'.
                const uniqueModels: string[] = [...new Set(partner.price_list.map((p): string => p.model))];
                uniqueModels.sort((a, b) => b.length - a.length);

                for (const modelName of uniqueModels) {
                    if (deviceName.startsWith(modelName + ' ') || deviceName === modelName) {
                        model = modelName;
                        storage = deviceName.substring(modelName.length).trim();
                        break; 
                    }
                }
            }
            
            if (!model && deviceName) {
                const parts = deviceName.split(' ');
                const lastPart = parts[parts.length - 1];
                if (parts.length > 1 && lastPart && (lastPart.toUpperCase().includes('GB') || lastPart.toUpperCase().includes('TB'))) {
                    storage = parts.pop() || '';
                    model = parts.join(' ');
                } else {
                    model = deviceName;
                    storage = '';
                }
            }

            setFormState({
                ...initialFormState,
                ...contractToEdit,
                model: model,
                storage: storage,
                total_amount: perUnitTotalAmount,
                daily_deduction: perUnitDailyDeduction,
                contract_date: contractToEdit.contract_date.split('T')[0],
                expiry_date: contractToEdit.expiry_date.split('T')[0],
                execution_date: contractToEdit.execution_date?.split('T')[0] || null,
                shipping_date: contractToEdit.shipping_date?.split('T')[0] || null,
                settlement_date: contractToEdit.settlement_date?.split('T')[0] || null,
            });
        } else {
            const newFormState = { ...initialFormState, ...(template || {})};
            if (!newFormState.execution_date) {
                newFormState.execution_date = newFormState.contract_date;
            }
            setFormState(newFormState);
        }
    }
  }, [contractToEdit, isOpen, template, partners]);

  useEffect(() => {
    if (contractToEdit) return;

    if (selectedPartner?.price_list && formState.model && formState.storage && formState.duration_days) {
      const priceTier = selectedPartner.price_list.find(
        p => p.model === formState.model && p.storage === formState.storage && p.duration_days === formState.duration_days
      );
      if (priceTier) {
        setFormState(prev => ({
          ...prev,
          total_amount: priceTier.total_amount,
          daily_deduction: priceTier.daily_deduction,
        }));
      }
    } else {
        setFormState(prev => ({
            ...prev,
            total_amount: 0,
            daily_deduction: 0,
        }));
    }
  }, [formState.model, formState.storage, formState.duration_days, selectedPartner, contractToEdit]);
  
  useEffect(() => {
    if (formState.execution_date && formState.duration_days > 0) {
      const parts = formState.execution_date.split('-').map(Number);
      // 타임존 문제를 피하기 위해 UTC 기준으로 날짜를 생성합니다.
      const startDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      
      // UTC 기준으로 날짜를 더합니다.
      startDate.setUTCDate(startDate.getUTCDate() + formState.duration_days - 1);
      
      // UTC 날짜에서 YYYY-MM-DD 형식으로 변환합니다.
      setFormState(prev => ({...prev, expiry_date: startDate.toISOString().split('T')[0]}));
    } else {
      setFormState(prev => ({...prev, expiry_date: ''}));
    }
  }, [formState.execution_date, formState.duration_days]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const isCheckbox = type === 'checkbox';
    const checked = isCheckbox ? (e.target as HTMLInputElement).checked : undefined;
    
    const numericFields = ['duration_days', 'total_amount', 'daily_deduction', 'settlement_round', 'procurement_cost', 'units_required', 'units_secured', 'contract_initial_deduction'];
    const isNumeric = numericFields.includes(name);

    setFormState(prev => {
        const parsedValue = isCheckbox ? checked : (isNumeric ? (value === '' ? null : Number(value)) : value);
        let newState = { ...prev, [name]: parsedValue };

        if (name === 'partner_id') {
            newState.model = '';
            newState.storage = '';
            newState.duration_days = 0;
        }
        if (name === 'model') {
            newState.storage = '';
            newState.duration_days = 0;
        }
        if (name === 'storage') {
           newState.duration_days = 0;
        }
        if (name === 'contract_date' && !newState.execution_date) {
            newState.execution_date = value;
        }
        return newState;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.partner_id || !formState.model || !formState.storage || !formState.duration_days) {
      alert('파트너사, 기종, 용량, 계약 기간은 필수 항목입니다.');
      return;
    }
    const device_name = `${formState.model} ${formState.storage}`.trim();
    
    const execution_date = formState.execution_date || formState.contract_date;

    const tempObject = { ...formState, execution_date };
    const { model, storage, ...contractData } = tempObject;
    
    // NOTE: The form state holds per-unit prices. We don't need to multiply here
    // because we are saving per-unit prices to the DB. The multiplication happens
    // at runtime in App.tsx's `processContracts`.
    const finalContractData = { ...contractData, device_name };

    Object.keys(finalContractData).forEach(keyStr => {
        const key = keyStr as keyof typeof finalContractData;
        if ((finalContractData as any)[key] === '') {
            (finalContractData as any)[key] = null;
        }
    });

    if (!contractToEdit?.id) {
        delete (finalContractData as any).id;
        delete (finalContractData as any).contract_number;
    }

    onSave(finalContractData);
  };
  
  const title = contractToEdit ? `[#${contractToEdit.contract_number}] 계약 정보 수정` : '신규 계약 추가';
  const isPricingLocked = !contractToEdit && !!selectedPartner?.price_list && availableModels.length > 0;
  const inputClass = "w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const disabledInputClass = `${inputClass} disabled:opacity-50`;
  const readonlyInputClass = `${inputClass} bg-slate-600 text-slate-300 cursor-not-allowed`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6">
            <FormSection title="기본 정보">
                <FormField label="파트너사">
                    <select name="partner_id" value={formState.partner_id} onChange={handleChange} required className={inputClass}>
                        <option value="" disabled>파트너사 선택</option>
                        {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </FormField>
                <FormField label="기종">
                    <select name="model" value={formState.model} onChange={handleChange} required disabled={!formState.partner_id} className={disabledInputClass}>
                        <option value="" disabled>기종 선택</option>
                        {availableModels.map(model => <option key={model} value={model}>{model}</option>)}
                    </select>
                </FormField>
                <FormField label="용량">
                    <select name="storage" value={formState.storage} onChange={handleChange} required disabled={!formState.model} className={disabledInputClass}>
                        <option value="" disabled>용량 선택</option>
                        {availableStorages.map(storage => <option key={storage} value={storage}>{storage}</option>)}
                    </select>
                </FormField>
                <FormField label="색상">
                    <input type="text" name="color" value={formState.color || ''} onChange={handleChange} required placeholder="예: 네츄럴 티타늄" className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="계약 및 금액 정보">
                <FormField label="계약 기간 (일)">
                    <select name="duration_days" value={formState.duration_days} onChange={handleChange} required disabled={!formState.storage} className={disabledInputClass}>
                        <option value={0} disabled>기간 선택</option>
                        {availableDurations.map(days => <option key={days} value={days}>{days}일</option>)}
                    </select>
                </FormField>
                 <FormField label="필요 수량">
                    <input type="number" name="units_required" value={formState.units_required || 1} onChange={handleChange} className={inputClass} min="1"/>
                </FormField>
                <FormField label="계약일">
                    <input type="date" name="contract_date" value={formState.contract_date} onChange={handleChange} required className={inputClass} />
                </FormField>
                <FormField label="실행일 (미입력 시 계약일과 동일)">
                    <input type="date" name="execution_date" value={formState.execution_date || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="만료일 (자동 계산)">
                    <input type="date" name="expiry_date" value={formState.expiry_date} readOnly className={readonlyInputClass} />
                </FormField>
                <FormField label="계약서 일차감액 (원, 선택사항)">
                    <input type="number" name="contract_initial_deduction" value={formState.contract_initial_deduction || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                 <FormField label="단가별 총 채권액 (원)">
                      <input type="number" name="total_amount" value={formState.total_amount || ''} onChange={handleChange} required readOnly={isPricingLocked} className={isPricingLocked ? readonlyInputClass : inputClass} />
                      {(formState.units_required || 1) > 1 && 
                          <p className="text-xs text-slate-400 mt-1">총 채권액 (수량x단가): <span className="font-semibold text-green-400">{formatCurrency((formState.total_amount || 0) * (formState.units_required || 1))}</span></p>
                      }
                 </FormField>
                 <FormField label="단가별 일차감 (원)">
                      <input type="number" name="daily_deduction" value={formState.daily_deduction || ''} onChange={handleChange} required readOnly={isPricingLocked} className={isPricingLocked ? readonlyInputClass : inputClass} />
                       {(formState.units_required || 1) > 1 && 
                          <p className="text-xs text-slate-400 mt-1">총 일차감 (수량x단가): <span className="font-semibold text-yellow-400">{formatCurrency((formState.daily_deduction || 0) * (formState.units_required || 1))}</span></p>
                      }
                 </FormField>
            </FormSection>
            
            <FormSection title="조달 및 고객 배송 정보">
                <FormField label="조달 상태">
                    <select name="procurement_status" value={formState.procurement_status ?? ''} onChange={handleChange} className={inputClass}>
                        {Object.values(ProcurementStatus).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="조달처">
                    <input type="text" name="procurement_source" value={formState.procurement_source || ''} onChange={handleChange} placeholder="예: KT 공식 대리점" className={inputClass} />
                </FormField>
                <FormField label="조달 비용 (원)">
                    <input type="number" name="procurement_cost" value={formState.procurement_cost || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                 <FormField label="확보 수량">
                     <input type="number" name="units_secured" value={formState.units_secured || 0} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="고객 배송 방법" className="md:col-span-2">
                    <input type="text" name="delivery_method_to_lessee" value={formState.delivery_method_to_lessee || ''} onChange={handleChange} placeholder="예: 택배, 퀵서비스" className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="고객 배송 정보">
                <FormField label="배송 상태">
                    <select name="shipping_status" value={formState.shipping_status ?? ''} onChange={handleChange} className={inputClass}>
                        {Object.values(ShippingStatus).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="배송일">
                    <input type="date" name="shipping_date" value={formState.shipping_date || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="배송 업체">
                    <input type="text" name="shipping_company" value={formState.shipping_company || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="운송장 번호">
                    <input type="text" name="tracking_number" value={formState.tracking_number || ''} onChange={handleChange} className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="총판 정보 (선택)">
                <FormField label="총판명">
                     <input type="text" name="distributor_name" value={formState.distributor_name || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="연락처">
                    <input type="text" name="distributor_contact" value={formState.distributor_contact || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="사업자번호">
                    <input type="text" name="distributor_business_number" value={formState.distributor_business_number || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="사업자주소">
                    <input type="text" name="distributor_address" value={formState.distributor_address || ''} onChange={handleChange} className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="계약자(라이더) 정보">
                <FormField label="계약자명">
                     <input type="text" name="lessee_name" value={formState.lessee_name || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="연락처">
                    <input type="text" name="lessee_contact" value={formState.lessee_contact || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="사업자번호">
                    <input type="text" name="lessee_business_number" value={formState.lessee_business_number || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="사업자주소">
                    <input type="text" name="lessee_business_address" value={formState.lessee_business_address || ''} onChange={handleChange} className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="정산 및 기타 정보">
                 <FormField label="계약 상태">
                    <select name="status" value={formState.status} onChange={handleChange} required className={inputClass}>
                        {Object.values(ContractStatus).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="정산차수">
                    <input type="number" name="settlement_round" value={formState.settlement_round || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="정산일">
                    <input type="date" name="settlement_date" value={formState.settlement_date || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="담당자">
                    <input type="text" name="manager_name" value={formState.manager_name || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="계약서 파일 URL">
                    <input type="text" name="contract_file_url" value={formState.contract_file_url || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                 <div className="flex items-center pt-2">
                    <input
                        type="checkbox"
                        id="is_lessee_contract_signed"
                        name="is_lessee_contract_signed"
                        checked={formState.is_lessee_contract_signed}
                        onChange={handleChange}
                        className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="is_lessee_contract_signed" className="ml-2 block text-sm text-slate-300">
                        고객 계약 완료 여부
                    </label>
                </div>
            </FormSection>
            
            <footer className="p-6 mt-auto border-t border-slate-700 bg-slate-800/50 flex justify-end space-x-4 -m-6 pt-6">
                <button type="button" onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                    취소
                </button>
                <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                    저장
                </button>
            </footer>
        </form>
      </div>
    </div>
  );
};