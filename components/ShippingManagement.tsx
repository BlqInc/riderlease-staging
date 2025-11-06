import React, { useState, useMemo } from 'react';
import { Contract, Partner, ShippingStatus, ProcurementStatus } from '../types';
import { formatDate, formatCurrency } from '../lib/utils';

interface ShippingManagementProps {
  contracts: Contract[];
  partners: Partner[];
  onSelectContract: (contract: Contract) => void;
}

const ProcurementStatusBadge: React.FC<{ status?: ProcurementStatus }> = ({ status }) => {
  if (!status) return null;
  const baseClasses = "px-2 py-1 text-xs font-semibold rounded-full";
  const statusClasses = {
    [ProcurementStatus.SECURED]: "bg-green-500/20 text-green-300",
    [ProcurementStatus.UNSECURED]: "bg-yellow-500/20 text-yellow-300",
  };
  return <span className={`${baseClasses} ${statusClasses[status]}`}>{status}</span>;
};

const ShippingStatusBadge: React.FC<{ status?: ShippingStatus }> = ({ status }) => {
  if (!status) return null;
  const baseClasses = "px-2 py-1 text-xs font-semibold rounded-full";
  const statusClasses = {
    [ShippingStatus.PREPARING]: "bg-gray-500/20 text-gray-300",
    [ShippingStatus.SHIPPED]: "bg-blue-500/20 text-blue-300",
    [ShippingStatus.DELIVERED]: "bg-green-500/20 text-green-300",
  };
  return <span className={`${baseClasses} ${statusClasses[status]}`}>{status}</span>;
};

export const ShippingManagement: React.FC<ShippingManagementProps> = ({ contracts, partners, onSelectContract }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);

  const filteredContracts = useMemo(() => {
    return contracts
      .filter(c => {
        const partnerName = partnerMap.get(c.partnerId) || '';
        const lesseeName = c.lesseeName || '';
        const contractNumberString = String(c.contractNumber);
        return (
          c.deviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          partnerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          lesseeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          contractNumberString.includes(searchTerm)
        );
      })
      .sort((a, b) => new Date(b.contractDate).getTime() - new Date(a.contractDate).getTime());
  }, [contracts, searchTerm, partnerMap]);

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-white">조달 및 배송 현황</h2>
      </div>

      <div className="flex items-center space-x-4 bg-slate-800 p-4 rounded-lg mb-6">
        <input
          type="text"
          placeholder="계약번호, 기기명, 계약자명 검색..."
          className="bg-slate-700 text-white placeholder-slate-400 rounded-lg px-4 py-2 w-full md:w-1/3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="p-4 font-semibold text-slate-400">계약번호</th>
                <th className="p-4 font-semibold text-slate-400">계약자</th>
                <th className="p-4 font-semibold text-slate-400">기기명</th>
                <th className="p-4 font-semibold text-slate-400 text-center">조달상태</th>
                <th className="p-4 font-semibold text-slate-400 text-center">확보/필요</th>
                <th className="p-4 font-semibold text-slate-400">조달처/비용</th>
                <th className="p-4 font-semibold text-slate-400">고객배송방법</th>
                <th className="p-4 font-semibold text-slate-400 text-center">고객배송상태</th>
              </tr>
            </thead>
            <tbody>
              {filteredContracts.map(contract => (
                <tr key={contract.id} onClick={() => onSelectContract(contract)} className="border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer transition-colors">
                  <td className="p-4 text-center font-mono text-indigo-400">#{contract.contractNumber}</td>
                  <td className="p-4">{contract.lesseeName}</td>
                  <td className="p-4 font-medium text-white">{contract.deviceName}</td>
                  <td className="p-4 text-center"><ProcurementStatusBadge status={contract.procurementStatus} /></td>
                  <td className="p-4 text-center">{contract.unitsSecured || 0} / {contract.unitsRequired || 0}</td>
                  <td className="p-4">
                    <div>{contract.procurementSource || 'N/A'}</div>
                    <div className="text-xs text-slate-400">{contract.procurementCost ? formatCurrency(contract.procurementCost) : ''}</div>
                  </td>
                  <td className="p-4">{contract.deliveryMethodToLessee || 'N/A'}</td>
                  <td className="p-4 text-center"><ShippingStatusBadge status={contract.shippingStatus} /></td>
                </tr>
              ))}
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