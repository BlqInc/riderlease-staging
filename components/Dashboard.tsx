
import React, { useState, useMemo } from 'react';
import { Contract, Partner, DeductionStatus, SettlementStatus } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';

interface DashboardProps {
  contracts: Contract[];
  partners: Partner[];
}

const StatCard: React.FC<{ title: string; value: string | number; description: string; colorClass?: string }> = ({ title, value, description, colorClass = "bg-slate-800" }) => (
  <div className={`${colorClass} p-6 rounded-lg shadow-lg border border-slate-700`}>
    <h3 className="text-sm font-medium text-slate-400">{title}</h3>
    <p className="text-3xl font-bold text-white mt-2">{value}</p>
    <p className="text-xs text-slate-500 mt-1">{description}</p>
  </div>
);

export const Dashboard: React.FC<DashboardProps> = ({ contracts = [], partners = [] }) => {
  // Ensure inputs are arrays to prevent crashes
  const safeContracts = Array.isArray(contracts) ? contracts : [];
  const safePartners = Array.isArray(partners) ? partners : [];

  // 상위 통계 — 단일 패스 reduce로 결합 (기존: 4번 순회 → 1번)
  const { totalReceivables, totalPaid, activeContracts, totalSettlementRequested } = useMemo(() => {
    let totalReceivables = 0;
    let totalPaid = 0;
    let activeContracts = 0;
    let totalSettlementRequested = 0;
    for (let i = 0; i < safeContracts.length; i++) {
      const c = safeContracts[i];
      const amount = Number(c.total_amount) || 0;
      totalReceivables += amount;
      if (c.status === '진행중') activeContracts++;
      if (c.settlement_status === SettlementStatus.REQUESTED || c.settlement_status === SettlementStatus.COMPLETED) {
        totalSettlementRequested += amount;
      }
      const deductions = c.daily_deductions || [];
      for (let j = 0; j < deductions.length; j++) {
        const d = deductions[j];
        if (d.status === DeductionStatus.PAID) totalPaid += (Number(d.amount) || 0);
      }
    }
    return { totalReceivables, totalPaid, activeContracts, totalSettlementRequested };
  }, [safeContracts]);

  const partnerMap = useMemo(() => {
      const map = new Map<string, string>();
      safePartners.forEach(p => {
          if(p && p.id) map.set(p.id, String(p.name || ''));
      });
      return map;
  }, [safePartners]);

  // 총판별 요약 — today는 루프 외부에서 한 번만 계산; 모든 집계를 단일 패스로
  const distributorSummary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map<string, { contracts: number; units: number; amount: number; paid: number; overdue: number }>();
    for (let i = 0; i < safeContracts.length; i++) {
      const c = safeContracts[i];
      const name = c.distributor_name || '미지정';
      let prev = map.get(name);
      if (!prev) {
        prev = { contracts: 0, units: 0, amount: 0, paid: 0, overdue: 0 };
        map.set(name, prev);
      }
      // 일차감 반복: 납부금액 합계 + 연체 여부를 단일 패스로
      const deductions = c.daily_deductions || [];
      let paidAmount = 0;
      let hasOverdue = false;
      for (let j = 0; j < deductions.length; j++) {
        const d = deductions[j];
        if (d.status === DeductionStatus.PAID) paidAmount += (Number(d.amount) || 0);
        else if (!hasOverdue && d.date <= today) hasOverdue = true;
      }
      prev.contracts += 1;
      prev.units += (Number(c.units_required) || 1);
      prev.amount += (Number(c.total_amount) || 0);
      prev.paid += paidAmount;
      if (hasOverdue) prev.overdue += 1;
    }
    const arr: { name: string; contracts: number; units: number; amount: number; paid: number; overdue: number; rate: number }[] = [];
    map.forEach((v, name) => {
      arr.push({ name, ...v, rate: v.amount > 0 ? (v.paid / v.amount * 100) : 0 });
    });
    arr.sort((a, b) => b.amount - a.amount);
    return arr.slice(0, 20);
  }, [safeContracts]);

  // --- Search Logic ---
  const [searchType, setSearchType] = useState<'contract_date' | 'execution_date'>('contract_date');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [keyword, setKeyword] = useState('');

  const filteredContracts = useMemo(() => {
    return safeContracts.filter(c => {
        if (!c) return false;

        // 1. Date Filter
        const targetDateStr = searchType === 'contract_date' ? c.contract_date : c.execution_date;
        
        if (!targetDateStr && (startDate || endDate)) return false;
        
        if (targetDateStr) {
            if (startDate && targetDateStr < startDate) return false;
            if (endDate && targetDateStr > endDate) return false;
        }

        // 2. Keyword Filter
        if (keyword) {
            const lowerKey = keyword.toLowerCase();
            const lessee = String(c.lessee_name || '').toLowerCase();
            const distributor = String(c.distributor_name || '').toLowerCase();
            const device = String(c.device_name || '').toLowerCase();
            const cNumber = String(c.contract_number || '').toLowerCase();
            
            let partnerName = '';
            if (c.partner_id && partnerMap.has(c.partner_id)) {
                partnerName = String(partnerMap.get(c.partner_id) || '').toLowerCase();
            }

            const match = 
                lessee.includes(lowerKey) ||
                distributor.includes(lowerKey) ||
                device.includes(lowerKey) ||
                cNumber.includes(lowerKey) ||
                partnerName.includes(lowerKey);
                
            if (!match) return false;
        }

        return true;
    });
  }, [safeContracts, searchType, startDate, endDate, keyword, partnerMap]);

  const filteredStats = useMemo(() => {
      return filteredContracts.reduce((acc, c) => {
          acc.count += 1;
          acc.units += (Number(c.units_required) || 1);
          acc.amount += (Number(c.total_amount) || 0);
          return acc;
      }, { count: 0, units: 0, amount: 0 });
  }, [filteredContracts]);


  return (
    <div className="p-8 space-y-8 animate-fade-in">
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

      {/* Section 2: 총판별 요약 */}
      <div className="bg-slate-800 p-6 rounded-lg shadow-lg border border-slate-700">
        <h3 className="text-xl font-bold text-white mb-4">총판별 현황 (상위 20개)</h3>
        {distributorSummary.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="p-3 font-semibold text-slate-400 text-sm">총판명</th>
                  <th className="p-3 font-semibold text-slate-400 text-sm text-center">계약 수</th>
                  <th className="p-3 font-semibold text-slate-400 text-sm text-center">총 대수</th>
                  <th className="p-3 font-semibold text-slate-400 text-sm text-right">총 채권액</th>
                  <th className="p-3 font-semibold text-slate-400 text-sm text-right">납부액</th>
                  <th className="p-3 font-semibold text-slate-400 text-sm text-center">납부율</th>
                  <th className="p-3 font-semibold text-slate-400 text-sm text-center">연체</th>
                </tr>
              </thead>
              <tbody>
                {distributorSummary.map(d => (
                  <tr key={d.name} className="border-b border-slate-700 last:border-b-0 hover:bg-slate-700/30">
                    <td className="p-3 text-sm font-medium text-white">{d.name}</td>
                    <td className="p-3 text-sm text-center text-slate-300">{d.contracts}건</td>
                    <td className="p-3 text-sm text-center text-slate-300">{d.units}대</td>
                    <td className="p-3 text-sm text-right text-slate-300">{formatCurrency(d.amount)}</td>
                    <td className="p-3 text-sm text-right text-green-400">{formatCurrency(d.paid)}</td>
                    <td className="p-3 text-sm text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        d.rate >= 80 ? 'bg-green-500/20 text-green-300' :
                        d.rate >= 50 ? 'bg-yellow-500/20 text-yellow-300' :
                        'bg-red-500/20 text-red-300'
                      }`}>{d.rate.toFixed(1)}%</span>
                    </td>
                    <td className="p-3 text-sm text-center">
                      {d.overdue > 0 ? <span className="text-red-400 font-medium">{d.overdue}건</span> : <span className="text-slate-500">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-center py-8">데이터가 없습니다.</p>
        )}
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
                      <label className="block text-xs font-medium text-slate-400 mb-1">검색어 (파트너, 총판, 계약자, 기기명)</label>
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
                          <th className="p-4 whitespace-nowrap">계약번호</th>
                          <th className="p-4 whitespace-nowrap">파트너사</th>
                          <th className="p-4 whitespace-nowrap">총판</th>
                          <th className="p-4 whitespace-nowrap">계약자</th>
                          <th className="p-4 whitespace-nowrap">기기명</th>
                          <th className="p-4 whitespace-nowrap">계약일</th>
                          <th className="p-4 whitespace-nowrap">실행일</th>
                          <th className="p-4 whitespace-nowrap">만료일</th>
                          <th className="p-4 whitespace-nowrap text-center">수량</th>
                          <th className="p-4 whitespace-nowrap text-right">채권액</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700 text-sm">
                      {filteredContracts.length > 0 ? (
                          filteredContracts.map(c => (
                              <tr key={c.id} className="hover:bg-slate-700/30 transition-colors">
                                  <td className="p-4 font-mono text-slate-400">#{c.contract_number}</td>
                                  <td className="p-4 text-slate-300">{(c.partner_id && partnerMap.has(c.partner_id) ? partnerMap.get(c.partner_id) : '-') || '-'}</td>
                                  <td className="p-4 text-white">{c.distributor_name || '-'}</td>
                                  <td className="p-4 text-white">{c.lessee_name}</td>
                                  <td className="p-4 text-slate-300">{c.device_name || '-'}</td>
                                  <td className="p-4 text-slate-400">{formatDate(c.contract_date)}</td>
                                  <td className="p-4 text-slate-400">{c.execution_date ? formatDate(c.execution_date) : '-'}</td>
                                  <td className="p-4 text-slate-400">{formatDate(c.expiry_date)}</td>
                                  <td className="p-4 text-center text-slate-300">{c.units_required || 1}</td>
                                  <td className="p-4 text-right font-medium text-slate-200">{formatCurrency(Number(c.total_amount) || 0)}</td>
                              </tr>
                          ))
                      ) : (
                          <tr>
                              <td colSpan={10} className="p-8 text-center text-slate-500">조건에 맞는 계약 데이터가 없습니다.</td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
      </div>
    </div>
  );
};
