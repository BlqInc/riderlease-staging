import React, { useState, useMemo } from 'react';
import { Contract } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { exportToCsv } from '../lib/csvUtils';
import { DownloadIcon } from './icons/IconComponents';

interface CreditorSettlementDataProps {
  contracts: Contract[];
}

export const CreditorSettlementData: React.FC<CreditorSettlementDataProps> = ({ contracts }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [settlementRoundFilter, setSettlementRoundFilter] = useState<string>('all');

  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
      const searchMatch = 
        (c.distributor_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.lessee_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.device_name.toLowerCase().includes(searchTerm.toLowerCase());
      
      const roundMatch = settlementRoundFilter === 'all' || String(c.settlement_round || '미지정') === settlementRoundFilter;

      return searchMatch && roundMatch;
    });
  }, [contracts, searchTerm, settlementRoundFilter]);
  
  const settlementRounds = useMemo(() => {
    const rounds = new Set<string>();
    contracts.forEach(c => {
        if (c.settlement_round) {
            rounds.add(String(c.settlement_round));
        } else {
            rounds.add('미지정');
        }
    });
    return ['all', ...Array.from(rounds).sort((a,b) => {
        if (a === '미지정') return 1;
        if (b === '미지정') return -1;
        return Number(a) - Number(b);
    })];
  }, [contracts]);

  const handleExport = () => {
    const header = ['정산차수', '총판', '계약자(라이더)', '기기명', '계약일', '실행일', '총채권액', '일차감액', '계약서 일차감액', '수량'];
    const rows = filteredContracts.map(c => [
        c.settlement_round ? `${c.settlement_round}차` : '미지정',
        c.distributor_name || '',
        c.lessee_name || '',
        c.device_name,
        c.contract_date,
        c.execution_date || '',
        c.total_amount,
        c.daily_deduction,
        c.contract_initial_deduction || 0,
        c.units_required || 1
    ]);
    exportToCsv(`채권사_정산데이터_${new Date().toISOString().split('T')[0]}.csv`, [header, ...rows]);
  };

  return (
    <div className="p-8">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-3xl font-bold text-white">채권사 정산 데이터</h2>
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
                placeholder="총판명, 계약자명, 기기명 검색..."
                className="bg-slate-700 text-white placeholder-slate-400 rounded-lg px-4 py-2 w-full md:w-1/3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
            <select
                className="bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={settlementRoundFilter}
                onChange={(e) => setSettlementRoundFilter(e.target.value)}
            >
                {settlementRounds.map(round => (
                    <option key={round} value={round}>
                        {round === 'all' ? '전체 정산차수' : (round === '미지정' ? '미지정' : `${round}차`)}
                    </option>
                ))}
            </select>
        </div>
        
        <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-700/50">
                        <tr>
                            <th className="p-4 font-semibold text-slate-400">정산차수</th>
                            <th className="p-4 font-semibold text-slate-400">총판</th>
                            <th className="p-4 font-semibold text-slate-400">계약자(라이더)</th>
                            <th className="p-4 font-semibold text-slate-400">기기명</th>
                            <th className="p-4 font-semibold text-slate-400">계약일</th>
                            <th className="p-4 font-semibold text-slate-400">실행일</th>
                            <th className="p-4 font-semibold text-slate-400 text-right">총채권액</th>
                            <th className="p-4 font-semibold text-slate-400 text-right">일차감액</th>
                            <th className="p-4 font-semibold text-slate-400 text-right">계약서 일차감액</th>
                            <th className="p-4 font-semibold text-slate-400 text-center">수량</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredContracts.map(contract => (
                            <tr key={contract.id} className="border-b border-slate-700 hover:bg-slate-700/50 transition-colors">
                                <td className="p-4">{contract.settlement_round ? `${contract.settlement_round}차` : '미지정'}</td>
                                <td className="p-4">{contract.distributor_name || 'N/A'}</td>
                                <td className="p-4 font-medium text-white">{contract.lessee_name || 'N/A'}</td>
                                <td className="p-4">{contract.device_name}</td>
                                <td className="p-4">{formatDate(contract.contract_date)}</td>
                                <td className="p-4">{contract.execution_date ? formatDate(contract.execution_date) : 'N/A'}</td>
                                <td className="p-4 text-right">{formatCurrency(contract.total_amount)}</td>
                                <td className="p-4 text-right text-yellow-400">{formatCurrency(contract.daily_deduction)}</td>
                                <td className="p-4 text-right text-sky-400">{contract.contract_initial_deduction ? formatCurrency(contract.contract_initial_deduction) : 'N/A'}</td>
                                <td className="p-4 text-center">{contract.units_required || 1}</td>
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