import React, { memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCurrency } from '../lib/utils';

export interface ChartDatum {
  name: string;
  fromDate: string;
  toDate: string;
  예상: number;
  수금: number;
  미납: number;
}

interface Props {
  data: ChartDatum[];
  onUnpaidClick?: (datum: ChartDatum) => void;
}

const TOOLTIP_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', color: '#fff' };
const TICK = { fill: '#94a3b8', fontSize: 11 };

const DashboardChart: React.FC<Props> = memo(({ data, onUnpaidClick }) => {
  return (
    <>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="name" tick={TICK} />
          <YAxis tick={TICK} tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, name: string) => [formatCurrency(value), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="예상" fill="#64748b" isAnimationActive={false} />
          <Bar dataKey="수금" fill="#22c55e" isAnimationActive={false} />
          <Bar dataKey="미납" fill="#ef4444" isAnimationActive={false}
            style={{ cursor: onUnpaidClick ? 'pointer' : undefined }}
            onClick={(d: any) => {
              if (!onUnpaidClick) return;
              // recharts는 클릭 시 payload에 row 데이터가 있음
              const payload = d?.payload || d;
              if (payload && payload.fromDate) onUnpaidClick(payload as ChartDatum);
            }} />
        </BarChart>
      </ResponsiveContainer>
      {onUnpaidClick && (
        <p className="text-xs text-slate-500 mt-2 text-center">💡 빨간색(미납) 막대를 클릭하면 상세 내역을 볼 수 있어요</p>
      )}
    </>
  );
});

export default DashboardChart;
