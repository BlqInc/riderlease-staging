
import React, { useMemo, useState, useEffect } from 'react';
import { Contract, Partner, SettlementStatus, ShippingStatus } from '../types';
import { formatDate, formatCurrency } from '../lib/utils';
import { SettlementPrepModal } from './SettlementPrepModal';

interface SettlementManagementProps {
  contracts: Contract[];
  partners: Partner[];
  onSelectContract: (contract: Contract) => void;
  onRequestSettlement: (contractId: string) => void;
  onCompleteSettlement: (contractId: string) => void;
  onUpdatePrerequisites: (contractId: string, updates: { shippingStatus?: ShippingStatus; isLesseeContractSigned: boolean; settlementDocumentUrl?: string; }) => void;
  onBulkRequestSettlement: (contractIds: string[]) => void;
  onBulkCompleteSettlement: (contractIds: string[]) => void;
}

type SettlementTab = SettlementStatus.NOT_READY | SettlementStatus.READY | SettlementStatus.REQUESTED | SettlementStatus.COMPLETED;

const CheckIcon: React.FC<{ checked: boolean }> = ({ checked }) => (
    <span className={`inline-block w-5 h-5 rounded-full flex items-center justify-center ${checked ? 'bg-green-500' : 'bg-slate-600'}`}>
        {checked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
    </span>
);


export const SettlementManagement: React.FC<SettlementManagementProps> = ({ 
    contracts, 
    partners, 
    onSelectContract, 
    onRequestSettlement, 
    onCompleteSettlement, 
    onUpdatePrerequisites,
    onBulkRequestSettlement,
    onBulkCompleteSettlement,
}) => {
  const [activeTab, setActiveTab] = useState<SettlementTab>(SettlementStatus.NOT_READY);
  const [prepModalContract, setPrepModalContract] = useState<Contract | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);

  const filteredContracts = useMemo(() => {
    return contracts.filter(c => c.settlementStatus === activeTab);
  }, [contracts, activeTab]);
  
  // Clear selection when tab changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const handleSelectAll = () => {
    if (selectedIds.size === filteredContracts.length) {
        setSelectedIds(new Set());
    } else {
        setSelectedIds(new Set(filteredContracts.map(c => c.id)));
    }
  };

  const handleSelectOne = (contractId: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(contractId)) {
        newSelectedIds.delete(contractId);
    } else {
        newSelectedIds.add(contractId);
    }
    setSelectedIds(newSelectedIds);
  };

  const handleBulkAction = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (activeTab === SettlementStatus.READY) {
        if (window.confirm(`${ids.length}개의 항목을 '정산 요청됨' 상태로 변경하시겠습니까?`)) {
            onBulkRequestSettlement(ids);
        }
    } else if (activeTab === SettlementStatus.REQUESTED) {
        if (window.confirm(`${ids.length}개의 항목을 '정산 완료' 상태로 변경하시겠습니까?`)) {
            onBulkCompleteSettlement(ids);
        }
    }
  };


  const tabItems: { key: SettlementTab, label: string }[] = [
      { key: SettlementStatus.NOT_READY, label: '준비중' },
      { key: SettlementStatus.READY, label: '정산 가능' },
      { key: SettlementStatus.REQUESTED, label: '정산 요청됨' },
      { key: SettlementStatus.COMPLETED, label: '정산 완료' },
  ];
  
  const isBulkActionable = activeTab === SettlementStatus.READY || activeTab === SettlementStatus.REQUESTED;

  return (
    <>
        <div className="p-8">
            <h2 className="text-3xl font-bold text-white mb-6">정산 관리</h2>

            <div className="mb-6 border-b border-slate-700">
                <nav className="-mb-px flex space-x-6" aria-label="Tabs">
                    {tabItems.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`${
                                activeTab === tab.key
                                    ? 'border-indigo-500 text-indigo-400'
                                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
                            } whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors focus:outline-none`}
                        >
                            {tab.label} ({contracts.filter(c => c.settlementStatus === tab.key).length})
                        </button>
                    ))}
                </nav>
            </div>
            
             {isBulkActionable && selectedIds.size > 0 && (
                <div className="bg-slate-700 p-3 rounded-lg mb-4 flex justify-between items-center animate-fade-in">
                    <span className="text-white font-semibold">{selectedIds.size}개 항목 선택됨</span>
                    <div>
                        <button 
                            onClick={() => setSelectedIds(new Set())}
                            className="text-slate-300 hover:text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm"
                        >
                            선택 취소
                        </button>
                        <button 
                            onClick={handleBulkAction}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm ml-2"
                        >
                            {activeTab === SettlementStatus.READY ? '일괄 정산 요청' : '일괄 완료 처리'}
                        </button>
                    </div>
                </div>
             )}

            <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-700/50">
                            <tr>
                                {isBulkActionable && (
                                    <th className="p-4 w-12 text-center">
                                        <input 
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-slate-500 bg-slate-600 text-indigo-600 focus:ring-indigo-500"
                                            checked={filteredContracts.length > 0 && selectedIds.size === filteredContracts.length}
                                            onChange={handleSelectAll}
                                        />
                                    </th>
                                )}
                                <th className="p-4 font-semibold text-slate-400">계약번호</th>
                                <th className="p-4 font-semibold text-slate-400">계약자</th>
                                <th className="p-4 font-semibold text-slate-400">기기명</th>
                                {activeTab === SettlementStatus.NOT_READY && <th className="p-4 font-semibold text-slate-400 text-center">정산 준비 상태</th>}
                                {activeTab === SettlementStatus.READY && <th className="p-4 font-semibold text-slate-400 text-center">준비 상태</th>}
                                {activeTab === SettlementStatus.REQUESTED && <th className="p-4 font-semibold text-slate-400">정산 요청일</th>}
                                {activeTab === SettlementStatus.COMPLETED && <th className="p-4 font-semibold text-slate-400">정산 완료일</th>}
                                <th className="p-4 font-semibold text-slate-400 text-right">총 채권액</th>
                                <th className="p-4 font-semibold text-slate-400 text-center">작업</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredContracts.map(contract => (
                                <tr key={contract.id} className="border-b border-slate-700">
                                    {isBulkActionable && (
                                        <td className="p-4 text-center">
                                            <input 
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-slate-500 bg-slate-600 text-indigo-600 focus:ring-indigo-500"
                                                checked={selectedIds.has(contract.id)}
                                                onChange={() => handleSelectOne(contract.id)}
                                            />
                                        </td>
                                    )}
                                    <td className="p-4 text-center font-mono text-indigo-400">
                                    <span className="hover:underline cursor-pointer" onClick={() => onSelectContract(contract)}>
                                        #{contract.contract_number}
                                    </span>
                                    </td>
                                    <td className="p-4">{contract.lesseeName}</td>
                                    <td className="p-4 font-medium text-white">{contract.deviceName}</td>
                                    
                                    {activeTab === SettlementStatus.NOT_READY && (
                                        <td className="p-4">
                                            <div className="flex items-center justify-center space-x-4">
                                                <div className="flex items-center space-x-2" title="배송완료 여부">
                                                    <CheckIcon checked={contract.shippingStatus === ShippingStatus.DELIVERED} />
                                                    <span className="text-xs">배송</span>
                                                </div>
                                                <div className="flex items-center space-x-2" title="고객 계약 완료 여부">
                                                    <CheckIcon checked={contract.isLesseeContractSigned} />
                                                    <span className="text-xs">계약</span>
                                                </div>
                                                 <div className="flex items-center space-x-2" title="정산서 작성 여부">
                                                    <CheckIcon checked={!!contract.settlementDocumentUrl} />
                                                     <span className="text-xs">정산서</span>
                                                </div>
                                            </div>
                                        </td>
                                    )}
                                    {activeTab === SettlementStatus.READY && (
                                        <td className="p-4">
                                            <div className="flex items-center justify-center space-x-4">
                                                <div className="flex items-center space-x-2" title="모든 조건 충족됨">
                                                    <CheckIcon checked={true} />
                                                    <span className="text-xs text-green-300">모두 완료</span>
                                                </div>
                                            </div>
                                        </td>
                                    )}
                                    {activeTab === SettlementStatus.REQUESTED && <td className="p-4">{contract.settlementRequestDate ? formatDate(contract.settlementRequestDate) : 'N/A'}</td>}
                                    {activeTab === SettlementStatus.COMPLETED && <td className="p-4">{contract.settlementDate ? formatDate(contract.settlementDate) : 'N/A'}</td>}
                                    
                                    <td className="p-4 text-right">{formatCurrency(contract.totalAmount)}</td>
                                    
                                    <td className="p-4 text-center">
                                        {activeTab === SettlementStatus.NOT_READY && (
                                            <button 
                                                onClick={() => setPrepModalContract(contract)}
                                                className="bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-bold py-2 px-3 rounded-md transition-colors shadow-sm"
                                            >
                                                정산 준비
                                            </button>
                                        )}
                                        {activeTab === SettlementStatus.READY && (
                                            <button 
                                                onClick={() => onRequestSettlement(contract.id)}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 px-3 rounded-md transition-colors shadow-sm"
                                            >
                                                정산 요청
                                            </button>
                                        )}
                                        {activeTab === SettlementStatus.REQUESTED && (
                                            <button 
                                                onClick={() => onCompleteSettlement(contract.id)}
                                                className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-2 px-3 rounded-md transition-colors shadow-sm"
                                            >
                                                완료 처리
                                            </button>
                                        )}
                                        {activeTab === SettlementStatus.COMPLETED && <span className="text-xs text-slate-500">처리 완료</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredContracts.length === 0 && (
                        <p className="p-8 text-center text-slate-400">해당 상태의 계약이 없습니다.</p>
                    )}
                </div>
            </div>
        </div>

        {prepModalContract && (
            <SettlementPrepModal
                isOpen={!!prepModalContract}
                onClose={() => setPrepModalContract(null)}
                contract={prepModalContract}
                onSave={(id, updates) => {
                    onUpdatePrerequisites(id, updates);
                    setPrepModalContract(null);
                }}
            />
        )}
    </>
  );
};
