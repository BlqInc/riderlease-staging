import React, { useState, useEffect, useMemo } from 'react';
import { Contract, Partner, ContractStatus, ShippingStatus, PriceTier, ProcurementStatus, SettlementStatus } from '../types';
import { CloseIcon } from './icons/IconComponents';

interface ContractFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (contract: Omit<Contract, 'dailyDeductions' | 'unpaidBalance' | 'id' | 'contractNumber' | 'settlementDocumentUrl'> & { id?: string }) => void;
  partners: Partner[];
  contractToEdit: Contract | null;
  template?: Partial<Contract>;
}

type FormState = Omit<Contract, 'dailyDeductions' | 'unpaidBalance' | 'deviceName' | 'id' | 'contractNumber'> & {
  id?: string;
  model: string;
  storage: string;
};

const initialFormState: FormState = {
  partnerId: '',
  model: '',
  storage: '',
  color: '',
  contractDate: new Date().toISOString().split('T')[0],
  expiryDate: '',
  durationDays: 0,
  totalAmount: 0,
  dailyDeduction: 0,
  status: ContractStatus.ACTIVE,
  isLesseeContractSigned: false,
  shippingStatus: ShippingStatus.PREPARING,
  procurementStatus: ProcurementStatus.UNSECURED,
  unitsRequired: 1,
  unitsSecured: 0,
  settlementRound: undefined,
  executionDate: undefined,
  shippingDate: undefined,
  shippingCompany: undefined,
  trackingNumber: undefined,
  settlementDate: undefined,
  managerName: undefined,
  lesseeName: undefined,
  lesseeContact: undefined,
  lesseeBusinessNumber: undefined,
  lesseeBusinessAddress: undefined,
  distributorName: undefined,
  distributorContact: undefined,
  distributorBusinessNumber: undefined,
  distributorAddress: undefined,
  contractFileUrl: '',
  procurementSource: undefined,
  procurementCost: undefined,
  deliveryMethodToLessee: undefined,
  settlementRequestDate: undefined,
  settlementStatus: SettlementStatus.NOT_READY,
};

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="bg-slate-900/50 p-4 rounded-lg">
        <h3 className="font-bold text-white mb-3 text-lg">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {children}
        </div>
    </div>
);

const FormField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <label className="block text-sm font-medium text-slate-400 mb-1">{label}</label>
        {children}
    </div>
);

export const ContractFormModal: React.FC<ContractFormModalProps> = ({ isOpen, onClose, onSave, partners, contractToEdit, template }) => {
  const [formState, setFormState] = useState<FormState>(initialFormState);

  const selectedPartner = useMemo(() => partners.find(p => p.id === formState.partnerId), [partners, formState.partnerId]);
  
  const availableModels = useMemo(() => {
    if (!selectedPartner?.priceList) return [];
    return [...new Set(selectedPartner.priceList.map(p => p.model))];
  }, [selectedPartner]);

  const availableStorages = useMemo(() => {
    if (!selectedPartner?.priceList || !formState.model) return [];
    const storages = selectedPartner.priceList
      .filter(p => p.model === formState.model)
      .map(p => p.storage);
    return [...new Set(storages)];
  }, [selectedPartner, formState.model]);
  
  const availableDurations = useMemo(() => {
    if (!selectedPartner?.priceList || !formState.model || !formState.storage) return [];
    return selectedPartner.priceList
      .filter(p => p.model === formState.model && p.storage === formState.storage)
      .map(p => p.durationDays);
  }, [selectedPartner, formState.model, formState.storage]);


  useEffect(() => {
    if (isOpen) {
        if (contractToEdit) {
            const parts = contractToEdit.deviceName.split(' ');
            const storage = parts.pop() || '';
            const model = parts.join(' ');

            setFormState({
                ...initialFormState,
                ...contractToEdit,
                model: model,
                storage: storage,
                contractDate: contractToEdit.contractDate.split('T')[0],
                expiryDate: contractToEdit.expiryDate.split('T')[0],
                executionDate: contractToEdit.executionDate?.split('T')[0],
                shippingDate: contractToEdit.shippingDate?.split('T')[0],
                settlementDate: contractToEdit.settlementDate?.split('T')[0],
            });
        } else {
            const newFormState = { ...initialFormState, ...(template || {})};
            if (!newFormState.executionDate) {
                newFormState.executionDate = newFormState.contractDate;
            }
            setFormState(newFormState);
        }
    }
  }, [contractToEdit, isOpen, template]);

  useEffect(() => {
    if (contractToEdit) return;

    if (selectedPartner?.priceList && formState.model && formState.storage && formState.durationDays) {
      const priceTier = selectedPartner.priceList.find(
        p => p.model === formState.model && p.storage === formState.storage && p.durationDays === formState.durationDays
      );
      if (priceTier) {
        setFormState(prev => ({
          ...prev,
          totalAmount: priceTier.totalAmount,
          dailyDeduction: priceTier.dailyDeduction,
        }));
      }
    } else {
        setFormState(prev => ({
            ...prev,
            totalAmount: 0,
            dailyDeduction: 0,
        }));
    }
  }, [formState.model, formState.storage, formState.durationDays, selectedPartner, contractToEdit]);
  
  useEffect(() => {
    if (formState.executionDate && formState.durationDays > 0) {
      const startDate = new Date(formState.executionDate);
      startDate.setDate(startDate.getDate() + formState.durationDays);
      setFormState(prev => ({...prev, expiryDate: startDate.toISOString().split('T')[0]}));
    } else {
      setFormState(prev => ({...prev, expiryDate: ''}));
    }
  }, [formState.executionDate, formState.durationDays]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const isCheckbox = type === 'checkbox';
    const checked = isCheckbox ? (e.target as HTMLInputElement).checked : undefined;
    
    const numericFields = ['durationDays', 'totalAmount', 'dailyDeduction', 'settlementRound', 'procurementCost', 'unitsRequired', 'unitsSecured'];
    const isNumeric = numericFields.includes(name);

    setFormState(prev => {
        const parsedValue = isCheckbox ? checked : (isNumeric ? Number(value) : value);
        let newState = { ...prev, [name]: parsedValue };

        if (name === 'partnerId') {
            newState.model = '';
            newState.storage = '';
            newState.durationDays = 0;
        }
        if (name === 'model') {
            newState.storage = '';
            newState.durationDays = 0;
        }
        if (name === 'storage') {
           newState.durationDays = 0;
        }
        if (name === 'contractDate' && !newState.executionDate) {
            newState.executionDate = value;
        }
        return newState;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.partnerId || !formState.model || !formState.storage || !formState.durationDays) {
      alert('파트너사, 기종, 용량, 계약 기간은 필수 항목입니다.');
      return;
    }
    const deviceName = `${formState.model} ${formState.storage}`;
    
    const executionDate = formState.executionDate || formState.contractDate;

    const tempObject = { ...formState, executionDate };
    const { model, storage, ...contractData } = tempObject;

    Object.keys(contractData).forEach(key => {
        const value = contractData[key as keyof typeof contractData];
        if (value === '') {
            delete contractData[key as keyof typeof contractData];
        }
    });

    const finalContractData: Omit<Contract, 'dailyDeductions' | 'unpaidBalance' | 'id' | 'contractNumber' | 'settlementDocumentUrl'> & { id?: string } = { ...contractData, deviceName };
    
    if (!contractToEdit?.id) {
        delete finalContractData.id;
    }

    onSave(finalContractData);
  };
  
  const title = contractToEdit ? `[#${contractToEdit.contractNumber}] 계약 정보 수정` : '신규 계약 추가';
  const isPricingLocked = !contractToEdit && !!selectedPartner?.priceList && availableModels.length > 0;
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
                    <select name="partnerId" value={formState.partnerId} onChange={handleChange} required className={inputClass}>
                        <option value="" disabled>파트너사 선택</option>
                        {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </FormField>
                <FormField label="기종">
                    <select name="model" value={formState.model} onChange={handleChange} required disabled={!formState.partnerId} className={disabledInputClass}>
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
                    <input type="text" name="color" value={formState.color} onChange={handleChange} required placeholder="예: 네츄럴 티타늄" className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="계약 및 금액 정보">
                <FormField label="계약 기간 (일)">
                    <select name="durationDays" value={formState.durationDays} onChange={handleChange} required disabled={!formState.storage} className={disabledInputClass}>
                        <option value={0} disabled>기간 선택</option>
                        {availableDurations.map(days => <option key={days} value={days}>{days}일</option>)}
                    </select>
                </FormField>
                <FormField label="계약일">
                    <input type="date" name="contractDate" value={formState.contractDate} onChange={handleChange} required className={inputClass} />
                </FormField>
                <FormField label="실행일 (미입력 시 계약일과 동일)">
                    <input type="date" name="executionDate" value={formState.executionDate || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="만료일 (자동 계산)">
                    <input type="date" name="expiryDate" value={formState.expiryDate} readOnly className={readonlyInputClass} />
                </FormField>
                 <FormField label="총 채권액 (원)">
                      <input type="number" name="totalAmount" value={formState.totalAmount} onChange={handleChange} required readOnly={isPricingLocked} className={isPricingLocked ? readonlyInputClass : inputClass} />
                 </FormField>
                 <FormField label="일차감 (원)">
                      <input type="number" name="dailyDeduction" value={formState.dailyDeduction} onChange={handleChange} required readOnly={isPricingLocked} className={isPricingLocked ? readonlyInputClass : inputClass} />
                 </FormField>
            </FormSection>
            
            <FormSection title="조달 및 고객 배송 정보">
                <FormField label="조달 상태">
                    <select name="procurementStatus" value={formState.procurementStatus} onChange={handleChange} className={inputClass}>
                        {Object.values(ProcurementStatus).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="조달처">
                    <input type="text" name="procurementSource" value={formState.procurementSource || ''} onChange={handleChange} placeholder="예: KT 공식 대리점" className={inputClass} />
                </FormField>
                <FormField label="조달 비용 (원)">
                    <input type="number" name="procurementCost" value={formState.procurementCost || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                 <FormField label="확보/필요 수량">
                    <div className="flex items-center space-x-2">
                        <input type="number" name="unitsSecured" value={formState.unitsSecured || 0} onChange={handleChange} className={inputClass} />
                         <span className="text-slate-400">/</span>
                        <input type="number" name="unitsRequired" value={formState.unitsRequired || 1} onChange={handleChange} className={inputClass} />
                    </div>
                </FormField>
                <FormField label="고객 배송 방법">
                    <input type="text" name="deliveryMethodToLessee" value={formState.deliveryMethodToLessee || ''} onChange={handleChange} placeholder="예: 택배, 퀵서비스" className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="고객 배송 정보">
                <FormField label="배송 상태">
                    <select name="shippingStatus" value={formState.shippingStatus} onChange={handleChange} className={inputClass}>
                        {Object.values(ShippingStatus).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="배송일">
                    <input type="date" name="shippingDate" value={formState.shippingDate || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="배송 업체">
                    <input type="text" name="shippingCompany" value={formState.shippingCompany || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="운송장 번호">
                    <input type="text" name="trackingNumber" value={formState.trackingNumber || ''} onChange={handleChange} className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="총판 정보 (선택)">
                <FormField label="총판명">
                     <input type="text" name="distributorName" value={formState.distributorName || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="연락처">
                    <input type="text" name="distributorContact" value={formState.distributorContact || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="사업자번호">
                    <input type="text" name="distributorBusinessNumber" value={formState.distributorBusinessNumber || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="사업자주소">
                    <input type="text" name="distributorAddress" value={formState.distributorAddress || ''} onChange={handleChange} className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="계약자(라이더) 정보">
                <FormField label="계약자명">
                     <input type="text" name="lesseeName" value={formState.lesseeName || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="연락처">
                    <input type="text" name="lesseeContact" value={formState.lesseeContact || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="사업자번호">
                    <input type="text" name="lesseeBusinessNumber" value={formState.lesseeBusinessNumber || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="사업자주소">
                    <input type="text" name="lesseeBusinessAddress" value={formState.lesseeBusinessAddress || ''} onChange={handleChange} className={inputClass} />
                </FormField>
            </FormSection>

            <FormSection title="정산 및 기타 정보">
                 <FormField label="계약 상태">
                    <select name="status" value={formState.status} onChange={handleChange} required className={inputClass}>
                        {Object.values(ContractStatus).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </FormField>
                <FormField label="정산차수">
                    <input type="number" name="settlementRound" value={formState.settlementRound || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="정산일">
                    <input type="date" name="settlementDate" value={formState.settlementDate || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="담당자">
                    <input type="text" name="managerName" value={formState.managerName || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                <FormField label="계약서 파일 URL">
                    <input type="text" name="contractFileUrl" value={formState.contractFileUrl || ''} onChange={handleChange} className={inputClass} />
                </FormField>
                 <div className="flex items-center pt-2">
                    <input
                        type="checkbox"
                        id="isLesseeContractSigned"
                        name="isLesseeContractSigned"
                        checked={formState.isLesseeContractSigned}
                        onChange={handleChange}
                        className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="isLesseeContractSigned" className="ml-2 block text-sm text-slate-300">
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
