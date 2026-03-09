import React, { useState, useMemo } from 'react';
import { Contract, ContractStatus, Partner, DeductionStatus } from '../types';
import { formatDate, formatCurrency } from '../lib/utils';
import { PlusIcon } from './icons/IconComponents';

interface ContractsListProps {
  contracts: Contract[];
  partners: Partner[];
  onSelectContract: (contract: Contract) => void;
  onAddContract: () => void;
  title: string;
  defaultStatusFilter?: ContractStatus;
}

const StatusBadge: React.FC<{ status: ContractStatus }> = ({ status }) => {
  const baseClasses = "px-2 py-1 text-xs font-semibold rounded-full";
  const statusClasses = {
    [ContractStatus.ACTIVE]: "bg-green-500/20 text-green-300",
    [ContractStatus.EXPIRED]: "bg-yellow-500/20 text-yellow-300",
    [ContractStatus.SETTLED]: "bg-sky-500/20 text-sky-300",
  };
  return <span className={`${baseClasses} ${statusClasses[status]}`}>{status}</span>;
};

export const ContractsList: React.FC<ContractsListProps> = ({ contracts, partners, onSelectContract, onAddContract, title, defaultStatusFilter }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>(defaultStatusFilter || 'all');
  
  const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);

  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
      // FIX: Property 'partnerId' does not exist on type 'Contract'. Did you mean 'partner_id'?
      const partnerName = partnerMap.get(c.partner_id) || '';
      const searchMatch = 
        // FIX: Property 'deviceName' does not exist on type 'Contract'. Did you mean 'device_name'?
        c.device_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        partnerName.toLowerCase().includes(searchTerm.toLowerCase());
      const statusMatch = statusFilter === 'all' || c.status === statusFilter;
      const defaultStatusMatch = !defaultStatusFilter || c.status === defaultStatusFilter;

      return searchMatch && (defaultStatusFilter ? defaultStatusMatch : statusMatch);
    });
  }, [contracts, searchTerm, statusFilter, partnerMap, defaultStatusFilter]);

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-white">{title}</h2>
        {title === '전체 계약 관리' && (
          <button 
            onClick={onAddContract}
            className="flex items-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-md hover:shadow-lg"
          >
            <PlusIcon className="w-5 h-5 mr-2"/>
            신규 계약 추가
          </button>
        )}
      </div>

      <div className="flex items-center space-x-4 bg-slate-800 p-4 rounded-lg mb-6">
        <input
          type="text"
          placeholder="기기명 또는 파트너사 검색..."
          className="bg-slate-700 text-white placeholder-slate-400 rounded-lg px-4 py-2 w-full md:w-1/3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {!defaultStatusFilter && (
            <select
                className="bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ContractStatus | 'all')}
            >
                <option value="all">모든 상태</option>
                <option value={ContractStatus.ACTIVE}>진행중</option>
                <option value={ContractStatus.EXPIRED}>만료</option>
                <option value={ContractStatus.SETTLED}>정산완료</option>
            </select>
        )}
      </div>

      <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="p-4 font-semibold text-slate-400">파트너사</th>
                <th className="p-4 font-semibold text-slate-400">기기명</th>
                <th className="p-4 font-semibold text-slate-400">만료일</th>
                <th className="p-4 font-semibold text-slate-400">총 채권액</th>
                <th className="p-4 font-semibold text-slate-400">잔액</th>
                <th className="p-4 font-semibold text-slate-400 text-center">상태</th>
              </tr>
            </thead>
            <tbody>
              {filteredContracts.map(contract => {
                // FIX: Property 'dailyDeductions' does not exist on type 'Contract'. Did you mean 'daily_deductions'?
                const totalPaid = (contract.daily_deductions || [])
                    .filter(d => d.status === DeductionStatus.PAID)
                    .reduce((sum, p) => sum + p.amount, 0);
                // FIX: Property 'totalAmount' does not exist on type 'Contract'. Did you mean 'total_amount'?
                const remaining = contract.total_amount - totalPaid;
                return (
                  <tr key={contract.id} onClick={() => onSelectContract(contract)} className="border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer transition-colors">
                    {/* FIX: Property 'partnerId' does not exist on type 'Contract'. Did you mean 'partner_id'? */}
                    <td className="p-4">{partnerMap.get(contract.partner_id)}</td>
                    {/* FIX: Property 'deviceName' does not exist on type 'Contract'. Did you mean 'device_name'? */}
                    <td className="p-4 font-medium text-white">{contract.device_name}</td>
                    {/* FIX: Property 'expiryDate' does not exist on type 'Contract'. Did you mean 'expiry_date'? */}
                    <td className="p-4">{formatDate(contract.expiry_date)}</td>
                    {/* FIX: Property 'totalAmount' does not exist on type 'Contract'. Did you mean 'total_amount'? */}
                    <td className="p-4">{formatCurrency(contract.total_amount)}</td>
                    <td className="p-4 text-yellow-400 font-semibold">{formatCurrency(remaining)}</td>
                    <td className="p-4 text-center"><StatusBadge status={contract.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredContracts.length === 0 && (
            <p className="p-8 text-center text-slate-400">일치하는 계약이 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
};
