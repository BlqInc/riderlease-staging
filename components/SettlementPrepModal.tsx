
import React, { useState, useEffect } from 'react';
import { Contract, ShippingStatus } from '../types';
import { CloseIcon } from './icons/IconComponents';

interface SettlementPrepModalProps {
  isOpen: boolean;
  onClose: () => void;
  contract: Contract;
  onSave: (contractId: string, updates: { 
    shipping_status?: ShippingStatus; 
    is_lessee_contract_signed: boolean; 
    settlement_document_url?: string; 
  }) => void;
}

export const SettlementPrepModal: React.FC<SettlementPrepModalProps> = ({
  isOpen,
  onClose,
  contract,
  onSave,
}) => {
  const [shipping_status, setShippingStatus] = useState(contract.shipping_status || ShippingStatus.PREPARING);
  const [is_lessee_contract_signed, setIsLesseeContractSigned] = useState(contract.is_lessee_contract_signed);
  const [settlement_document_url, setSettlementDocumentUrl] = useState(contract.settlement_document_url || '');

  useEffect(() => {
    setShippingStatus(contract.shipping_status || ShippingStatus.PREPARING);
    setIsLesseeContractSigned(contract.is_lessee_contract_signed);
    setSettlementDocumentUrl(contract.settlement_document_url || '');
  }, [contract]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(contract.id, {
      shipping_status,
      is_lessee_contract_signed,
      settlement_document_url,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <div>
            <h2 className="text-2xl font-bold text-white">정산 준비</h2>
            <p className="text-slate-400">{contract.lessee_name} / {contract.device_name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        
        <form onSubmit={handleSubmit}>
            <div className="p-6 space-y-6">
                <div>
                    <label htmlFor="shipping_status" className="block text-sm font-medium text-slate-400 mb-2">1. 배송 상태</label>
                    <select
                        id="shipping_status"
                        value={shipping_status}
                        onChange={(e) => setShippingStatus(e.target.value as ShippingStatus)}
                        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        {Object.values(ShippingStatus).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                     <p className="text-xs text-slate-500 mt-1">'배송완료' 상태여야 정산이 가능합니다.</p>
                </div>

                <div className="flex items-center">
                    <input
                        type="checkbox"
                        id="is_lessee_contract_signed"
                        checked={is_lessee_contract_signed}
                        onChange={(e) => setIsLesseeContractSigned(e.target.checked)}
                        className="h-5 w-5 rounded border-slate-500 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="is_lessee_contract_signed" className="ml-3 block font-medium text-slate-300">
                        2. 고객 계약 완료 여부
                    </label>
                </div>
                
                <div>
                    <label htmlFor="settlement_document_url" className="block text-sm font-medium text-slate-400 mb-2">3. 정산서 파일 URL</label>
                    <input 
                        id="settlement_document_url"
                        type="text" 
                        value={settlement_document_url} 
                        onChange={(e) => setSettlementDocumentUrl(e.target.value)} 
                        placeholder="정산서가 업로드된 URL을 입력하세요"
                        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                    />
                    <p className="text-xs text-slate-500 mt-1">URL이 입력되어야 정산이 가능합니다.</p>
                </div>

            </div>
            
            <footer className="p-6 bg-slate-800/50 flex justify-end space-x-4">
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
