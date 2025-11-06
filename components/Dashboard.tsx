
import React from 'react';
import { Contract, DeductionStatus, SettlementStatus } from '../types';
import { formatCurrency } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DashboardProps {
  contracts: Contract[];
}

const StatCard: React.FC<{ title: string; value: string | number; description: string }> = ({ title, value, description }) => (
  <div className="bg-slate-800 p-6 rounded-lg shadow-lg">
    <h3 className="text-sm font-medium text-slate-400">{title}</h3>
    <p className="text-3xl font-bold text-white mt-2">{value}</p>
    <p className="text-xs text-slate-500 mt-1">{description}</p>
  </div>
);

export const Dashboard: React.FC<DashboardProps> = ({ contracts }) => {
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

  return (
    <div className="p-8">
      <h2 className="text-3xl font-bold text-white mb-8">대시보드</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard title="총 채권 금액" value={formatCurrency(totalReceivables)} description="모든 계약의 총액" />
        <StatCard title="총 납부 금액" value={formatCurrency(totalPaid)} description="현재까지 납부된 총액" />
        <StatCard title="진행중 계약" value={activeContracts} description="현재 활성 상태인 계약 건수" />
        <StatCard title="정산 요청/완료 총액" value={formatCurrency(totalSettlementRequested)} description="채권사에 청구되었거나 완료된 금액" />
      </div>
      <div className="bg-slate-800 p-6 rounded-lg shadow-lg">
        <h3 className="text-xl font-bold text-white mb-4">계약별 현황</h3>
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
    </div>
  );
};
