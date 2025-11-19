\\\

import React, { useMemo, useState } from 'react';
import { Contract, Partner, DeductionStatus, ContractStatus } from '../types';
import { formatDate, formatCurrency } from '../lib/utils';
import { exportToCsv } from '../lib/csvUtils';
import { CloseIcon, DownloadIcon } from './icons/IconComponents';

interface DeductionManagementProps {
  contracts: Contract[];
  partners: Partner[];
  onAddPayment: (contractId: string, amount: number) => void;
  onSettleDeduction: (contractId: string, deductionId: string) => void;
  onCancelDeduction: (contractId: string, deductionId: string) => void;
}

const PaymentModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (amount: number) => void;
  contract: Contract;
}> = ({ isOpen, onClose, onSubmit, contract }) => {
  const [amount, setAmount] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amount);
    if (!isNaN(numericAmount) && numericAmount > 0) {
      onSubmit(numericAmount);
      setAmount('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <div>
            <h2 className="text-2xl font-bold text-white">입금 처리</h2>
            <p className="text-slate-400">{contract.lessee_name} / {contract.device_name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <div>
              <label htmlFor="paymentAmount" className="block text-sm font-medium text-slate-400 mb-2">입금액</label>
              <input
                id="paymentAmount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="입금된 금액을 입력하세요"
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
                autoFocus
              />
            </div>
            <div className="text-sm text-slate-400 bg-slate-900/50 p-3 rounded-md">
                <p>현재 미납액: <span className="font-bold text-red-400">{formatCurrency(contract.unpaid_balance)}</span></p>
                <p className="mt-1">입력된 금액은 가장 오래된 미납일부터 순서대로 자동 처리됩니다.</p>
            </div>
          </div>
          <footer className="p-6 bg-slate-800/50 flex justify-end space-x-4">
            <button type="button" onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
              취소
            </button>
            <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
              처리
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};


const DeductionStatusBadge: React.FC<{ status: DeductionStatus }> = ({ status }) => {
  const baseClasses = "px-2 py-1 text-xs font-semibold rounded-full";
  const statusClasses = {
    [DeductionStatus.PAID]: "bg-green-500/20 text-green-300",
    [DeductionStatus.UNPAID]: "bg-red-500/20 text-red-300",
    [DeductionStatus.PENDING]: "bg-slate-500/20 text-slate-300",
    [DeductionStatus.PARTIAL]: "bg-yellow-500/20 text-yellow-300",
  };
  return <span className={`${baseClasses} ${statusClasses[status]}`}>{status}</span>;
};

const ContractDeductionCard: React.FC<{
    contract: Contract;
    partnerName: string;
    isOpen: boolean;
    onToggle: () => void;
    onOpenPaymentModal: (contract: Contract) => void;
    onSettleDeduction: (contractId: string, deductionId: string) => void;
    onCancelDeduction: (contractId: string, deductionId: string) => void;
}> = ({ contract, partnerName, isOpen, onToggle, onOpenPaymentModal, onSettleDeduction, onCancelDeduction }) => {

    const totalPaid = (contract.daily_deductions || []).reduce((sum, d) => sum + d.paid_amount, 0);
    const balance = contract.total_amount - totalPaid;
    
    return (
        <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden transition-all duration-300">
            <div 
                className="flex justify-between items-center p-4 cursor-pointer hover:bg-slate-700/50"
                onClick={onToggle}
            >
                <div className="flex-1">
                    <p className="font-bold text-white text-lg">[#<span className="text-indigo-400">{contract.contract_number}</span>] - {contract.distributor_name || '총판 없음'} / {contract.lessee_name}</p>
                    <p className="text-sm text-slate-400">{contract.device_name} / {partnerName}</p>
                </div>
                <div className="flex-1 text-right px-4">
                    <p className="text-sm text-slate-400">미납액</p>
                    <p className={`font-bold text-xl ${contract.unpaid_balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {formatCurrency(contract.unpaid_balance)}
                    </p>
                </div>
                <div className="flex-1 text-right px-4">
                    <p className="text-sm text-slate-400">총 잔액</p>
                    <p className="font-bold text-xl text-yellow-400">{formatCurrency(balance)}</p>
                </div>
                <div className="flex items-center space-x-4 px-4">
                    <button 
                        onClick={(e) => { e.stopPropagation(); onOpenPaymentModal(contract); }}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm"
                    >
                        입금 처리
                    </button>
                    <svg className={`w-6 h-6 text-slate-400 transform transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>

            {isOpen && (
                <div className="p-4 border-t border-slate-700 bg-slate-800/50 animate-fade-in">
                    <h4 className="font-bold text-white mb-3 px-2">일일 차감 내역</h4>
                    <div className="max-h-80 overflow-y-auto space-y-2 pr-2">
                        {(contract.daily_deductions || []).length > 0 ? (
                            [...(contract.daily_deductions || [])].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(deduction => (
                                <div key={deduction.id} className="flex justify-between items-center bg-slate-700/80 p-3 rounded-md">
                                    <div>
                                        <p className="font-semibold text-white">{formatDate(deduction.date)}</p>
                                        <p className="text-sm font-semibold">
                                          {deduction.paid_amount > 0 ? (
                                              <><span className="text-yellow-400">{formatCurrency(deduction.paid_amount)}</span> / {formatCurrency(deduction.amount)}</>
                                          ) : (
                                              formatCurrency(deduction.amount)
                                          )}
                                        </p>
                                    </div>
                                    <div className="flex items-center space-x-3">
                                        <DeductionStatusBadge status={deduction.status} />
                                        {deduction.status !== DeductionStatus.PAID && (
                                            <button 
                                                onClick={() => onSettleDeduction(contract.id, deduction.id)}
                                                className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-1 px-3 rounded-md transition-colors"
                                            >
                                                전액 처리
                                            </button>
                                        )}
                                        {deduction.paid_amount > 0 && (
                                            <button 
                                                onClick={() => onCancelDeduction(contract.id, deduction.id)}
                                                className="bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-bold py-1 px-3 rounded-md transition-colors"
                                            >
                                                납부 취소
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-slate-400 py-4">생성된 일차감 내역이 없습니다.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};


export const DeductionManagement: React.FC<DeductionManagementProps> = ({ contracts, partners, onAddPayment, onSettleDeduction, onCancelDeduction }) => {
    const [openContractId, setOpenContractId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [paymentModalContract, setPaymentModalContract] = useState<Contract | null>(null);

    const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);

    const contractsToList = useMemo(() => {
        const filtered = contracts.filter(c => {
             const partnerName = partnerMap.get(c.partner_id) || '';
             const lesseeName = c.lessee_name || '';
             const distributorName = c.distributor_name || '';
             const searchMatch =
                c.device_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                partnerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                lesseeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                distributorName.toLowerCase().includes(searchTerm.toLowerCase());
            
            // '진행중'인 계약이거나, '만료'되었지만 미납액이 있는 계약만 표시합니다.
            const statusMatch = c.status === ContractStatus.ACTIVE || (c.status === ContractStatus.EXPIRED && c.unpaid_balance > 0);

            return statusMatch && searchMatch;
        });
        return filtered.sort((a,b) => (b.unpaid_balance || 0) - (a.unpaid_balance || 0));
    }, [contracts, partnerMap, searchTerm]);
    
    const summary = useMemo(() => {
        return contractsToList.reduce(
            (acc, contract) => {
                const totalPaid = (contract.daily_deductions || []).reduce((sum, d) => sum + d.paid_amount, 0);
                const balance = contract.total_amount - totalPaid;

                acc.totalUnpaid += contract.unpaid_balance;
                acc.totalBalance += balance;
                acc.totalDailyDeduction += contract.daily_deduction;
                return acc;
            },
            { totalUnpaid: 0, totalBalance: 0, totalDailyDeduction: 0 }
        );
    }, [contractsToList]);

    const handleToggleCard = (contractId: string) => {
        setOpenContractId(prevId => (prevId === contractId ? null : contractId));
    };
    
    const handleOpenPaymentModal = (contract: Contract) => {
      setPaymentModalContract(contract);
    };

    const handleClosePaymentModal = () => {
        setPaymentModalContract(null);
    };
    
    const handlePaymentSubmit = (amount: number) => {
        if (paymentModalContract) {
            onAddPayment(paymentModalContract.id, amount);
        }
        handleClosePaymentModal();
    };
    
    const handleExport = () => {
        const header = ['계약번호', '파트너사', '총판명', '계약자', '기기명', '차감일', '차감액', '납부액', '미납액', '상태'];
        const allActiveContracts = contracts.filter(c => c.status === ContractStatus.ACTIVE);

        const rows = allActiveContracts.flatMap(c => 
            (c.daily_deductions || []).map(d => [
                c.contract_number,
                partnerMap.get(c.partner_id) || 'N/A',
                c.distributor_name || 'N/A',
                c.lessee_name || 'N/A',
                c.device_name,
                d.date,
                d.amount,
                d.paid_amount,
                d.amount - d.paid_amount,
                d.status
            ])
        );
        exportToCsv(`일차감_전체내역_${new Date().toISOString().split('T')[0]}.csv`, [header, ...rows]);
    };

    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold text-white">일차감 관리</h2>
                <button
                    onClick={handleExport}
                    className="flex items-center bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-md hover:shadow-lg"
                >
                    <DownloadIcon className="w-5 h-5 mr-2" />
                    CSV로 내보내기
                </button>
            </div>
            
            <div className="flex items-center space-x-4 bg-slate-800 p-4 rounded-lg mb-6">
                <input
                  type="text"
                  placeholder="총판명, 계약자명, 기기명, 파트너사 검색..."
                  className="bg-slate-700 text-white placeholder-slate-400 rounded-lg px-4 py-2 w-full md:w-2/5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <div className="bg-slate-900/50 p-4 rounded-lg mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div>
                    <p className="text-sm text-slate-400">검색 결과 일일 차감 총액</p>
                    <p className="text-2xl font-bold text-white">{formatCurrency(summary.totalDailyDeduction)}</p>
                </div>
                <div>
                    <p className="text-sm text-slate-400">검색 결과 총 미납액</p>
                    <p className="text-2xl font-bold text-red-400">{formatCurrency(summary.totalUnpaid)}</p>
                </div>
                <div>
                    <p className="text-sm text-slate-400">검색 결과 총 잔액</p>
                    <p className="text-2xl font-bold text-yellow-400">{formatCurrency(summary.totalBalance)}</p>
                </div>
            </div>
            
            <div className="space-y-4">
                {contractsToList.map(contract => (
                    <ContractDeductionCard
                        key={contract.id}
                        contract={contract}
                        partnerName={partnerMap.get(contract.partner_id) || '알 수 없음'}
                        isOpen={openContractId === contract.id}
                        onToggle={() => handleToggleCard(contract.id)}
                        onOpenPaymentModal={handleOpenPaymentModal}
                        onSettleDeduction={onSettleDeduction}
                        onCancelDeduction={onCancelDeduction}
                    />
                ))}
                 {contractsToList.length === 0 && (
                    <div className="bg-slate-800 rounded-lg shadow-lg p-8 text-center text-slate-400">
                        <p>관리할 일차감 내역이 없거나 검색 결과가 없습니다.</p>
                    </div>
                )}
            </div>
            
            {paymentModalContract && (
                <PaymentModal
                    isOpen={!!paymentModalContract}
                    onClose={handleClosePaymentModal}
                    onSubmit={handlePaymentSubmit}
                    contract={paymentModalContract}
                />
            )}
        </div>
    );
};
