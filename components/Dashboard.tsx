
import React, { useState, useMemo } from 'react';
import { Contract, DeductionStatus, SettlementStatus } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DashboardProps {
  contracts: Contract[];
}

const StatCard: React.FC<{ title: string; value: string | number; description: string; colorClass?: string }> = ({ title, value, description, colorClass = "bg-slate-800" }) => (
  <div className={`${colorClass} p-6 rounded-lg shadow-lg border border-slate-700`}>
    <h3 className="text-sm font-medium text-slate-400">{title}</h3>
    <p className="text-3xl font-bold text-white mt-2">{value}</p>
    <p className="text-xs text-slate-500 mt-1">{description}</p>
  </div>
);

export const Dashboard: React.FC<DashboardProps> = ({ contracts }) => {
  // --- Existing Logic ---
  const totalReceivables = contracts.reduce((sum, c) => sum + c.total_amount, 0);
  const totalPaid = contracts.reduce((sum, c) => {
      const paidDeductions = (c.daily_deductions || [])
          .filter(d => d.status === DeductionStatus.PAID)
          .reduce((deductionSum, d) => deductionSum + d.amount, 0);
      return sum + paidDeductions;
  }, 0);
  const activeContracts = contracts.filter(c => c.status === '진행중').length;
  
  const totalSettlementRequested = contracts
    .filter(c => c.settlement_status === SettlementStatus.REQUESTED || c.settlement_status === SettlementStatus.COMPLETED)
    .reduce((sum, c) => sum + c.total_amount, 0);


  const chartData = contracts.map(c => {
      const paidAmount = (c.daily_deductions || [])
        .filter(d => d.status === DeductionStatus.PAID)
        .reduce((sum, d) => sum + d.amount, 0);
      return {
          name: c.device_name.slice(0, 10) + '...',
          '총 채권': c.total_amount,
          '납부액': paidAmount,
      };
  });

  // --- New Search Logic ---
  const [searchType, setSearchType] = useState<'contract_date' | 'execution_date'>('contract_date');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [keyword, setKeyword] = useState('');

  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
        // 1. Date Filter
        const targetDateStr = searchType === 'contract_date' ? c.contract_date : c.execution_date;
        if (!targetDateStr && (startDate || endDate)) return false; // 날짜 없는데 검색조건 있으면 제외
        
        if (targetDateStr) {
            if (startDate && targetDateStr < startDate) return false;
            if (endDate && targetDateStr > endDate) return false;
        }

        // 2. Keyword Filter
        if (keyword) {
            const lowerKey = keyword.toLowerCase();
            const match = 
                c.lessee_name?.toLowerCase().includes(lowerKey) ||
                c.distributor_name?.toLowerCase().includes(lowerKey) ||
                c.device_name.toLowerCase().includes(lowerKey) ||
                String(c.contract_number).includes(lowerKey);
            if (!match) return false;
        }

        return true;
    });
  }, [contracts, searchType, startDate, endDate, keyword]);

  const filteredStats =useMemo(() => {
      return filteredContracts.reduce((acc, c) => {
          acc.count += 1;
          acc.units += (c.units_required || 1);
          acc.amount += c.total_amount;
          return acc;
      }, { count: 0, units: 0, amount: 0 });
  }, [filteredContracts]);


  return (
    <div className="p-8 space-y-8">
      {/* Section 1: Global Overview */}
      <div>
        <h2 className="text-3xl font-bold text-white mb-6">대시보드</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard title="총 채권 금액" value={formatCurrency(totalReceivables)} description="모든 계약의 총액" />
            <StatCard title="총 납부 금액" value={formatCurrency(totalPaid)} description="현재까지 납부된 총액" />
            <StatCard title="진행중 계약" value={activeContracts} description="현재 활성 상태인 계약 건수" />
            <StatCard title="정산 요청/완료 총액" value={formatCurrency(totalSettlementRequested)} description="채권사에 청구되었거나 완료된 금액" />
        </div>
      </div>

      {/* Section 2: Charts */}
      <div className="bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
        <h3 className="text-xl font-bold text-white mb-4">계약별 현황 차트</h3>
        <div style={{ width: '100%', height: 400 }}>
             <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                    <XAxis dataKey="name" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" tickFormatter={(value) => `${Number(value) / 10000}만`} />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                        labelStyle={{ color: '#cbd5e1' }}
                        formatter={(value: number) => formatCurrency(value)}
                    />
                    <Legend />
                    <Bar dataKey="총 채권" fill="#4f46e5" />
                    <Bar dataKey="납부액" fill="#22c55e" />
                </BarChart>
            </ResponsiveContainer>
        </div>
      </div>

      {/* Section 3: Advanced Search & Analysis */}
      <div className="bg-slate-800 rounded-lg shadow-lg border border-slate-700 overflow-hidden">
          <div className="p-6 border-b border-slate-700 bg-slate-700/30">
              <h3 className="text-xl font-bold text-white flex items-center">
                  <svg className="w-6 h-6 mr-2 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                  </svg>
                  상세 검색 및 분석
              </h3>
              <p className="text-sm text-slate-400 mt-1">특정 기간의 성과를 조회하고 분석합니다.</p>
              
              <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">조회 기준일</label>
                      <div className="flex bg-slate-700 rounded-lg p-1">
                          <button 
                            onClick={() => setSearchType('contract_date')}
                            className={`flex-1 py-1 text-sm rounded-md transition-colors ${searchType === 'contract_date' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:text-white'}`}
                          >
                              계약일
                          </button>
                          <button 
                            onClick={() => setSearchType('execution_date')}
                            className={`flex-1 py-1 text-sm rounded-md transition-colors ${searchType === 'execution_date' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-300 hover:text-white'}`}
                          >
                              실행일
                          </button>
                      </div>
                  </div>
                  <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">기간 (시작 ~ 종료)</label>
                      <div className="flex items-center space-x-2">
                          <input 
                              type="date" 
                              value={startDate}
                              onChange={(e) => setStartDate(e.target.value)}
                              className="flex-1 bg-slate-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <span className="text-slate-500">~</span>
                          <input 
                              type="date" 
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                              className="flex-1 bg-slate-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                      </div>
                  </div>
                   <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-400 mb-1">검색어 (총판, 계약자, 기기명)</label>
                      <input 
                          type="text" 
                          value={keyword}
                          onChange={(e) => setKeyword(e.target.value)}
                          placeholder="검색어를 입력하세요..."
                          className="w-full bg-slate-700 text-white rounded-lg px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                  </div>
              </div>
          </div>
          
          {/* Filtered Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-b border-slate-700 divide-y md:divide-y-0 md:divide-x divide-slate-700">
               <div className="p-6 text-center bg-slate-800/50">
                   <p className="text-sm text-slate-400">검색된 계약 건수</p>
                   <p className="text-2xl font-bold text-white mt-1">{filteredStats.count}건</p>
               </div>
               <div className="p-6 text-center bg-slate-800/50">
                   <p className="text-sm text-slate-400">검색된 총 수량</p>
                   <p className="text-2xl font-bold text-indigo-400 mt-1">{filteredStats.units}대</p>
               </div>
               <div className="p-6 text-center bg-slate-800/50">
                   <p className="text-sm text-slate-400">검색된 총 채권액</p>
                   <p className="text-2xl font-bold text-green-400 mt-1">{formatCurrency(filteredStats.amount)}</p>
               </div>
          </div>

          {/* Filtered List */}
          <div className="overflow-x-auto">
              <table className="w-full text-left">
                  <thead className="bg-slate-700/50 text-slate-400 text-xs uppercase font-semibold">
                      <tr>
                          <th className="p-4">계약번호</th>
                          <th className="p-4">총판</th>
                          <th className="p-4">계약자</th>
                          <th className="p-4">기기명</th>
                          <th className="p-4">계약일</th>
                          <th className="p-4">실행일</th>
                          <th className="p-4 text-center">수량</th>
                          <th className="p-4 text-right">채권액</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700 text-sm">
                      {filteredContracts.length > 0 ? (
                          filteredContracts.map(c => (
                              <tr key={c.id} className="hover:bg-slate-700/30 transition-colors">
                                  <td className="p-4 font-mono text-slate-400">#{c.contract_number}</td>
                                  <td className="p-4 text-white">{c.distributor_name || '-'}</td>
                                  <td className="p-4 text-white">{c.lessee_name}</td>
                                  <td className="p-4 text-slate-300">{c.device_name}</td>
                                  <td className="p-4 text-slate-400">{formatDate(c.contract_date)}</td>
                                  <td className="p-4 text-slate-400">{c.execution_date ? formatDate(c.execution_date) : '-'}</td>
                                  <td className="p-4 text-center text-slate-300">{c.units_required || 1}</td>
                                  <td className="p-4 text-right font-medium text-slate-200">{formatCurrency(c.total_amount)}</td>
                              </tr>
                          ))
                      ) : (
                          <tr>
                              <td colSpan={8} className="p-8 text-center text-slate-500">조건에 맞는 계약 데이터가 없습니다.</td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
      </div>
    </div>
  );
};
