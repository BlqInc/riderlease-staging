import React from 'react';
import { DashboardIcon, ContractsIcon, PartnersIcon, SettlementIcon, DeductionIcon, ShippingIcon, CreditorDataIcon, CalendarIcon, DatabaseIcon } from './icons/IconComponents';

export type View = 'dashboard' | 'contractManagement' | 'deductionManagement' | 'shippingManagement' | 'settlementManagement' | 'creditorSettlementData' | 'partners' | 'database' | 'calendar';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const NavItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    isActive: boolean;
    onClick: () => void;
}> = ({ icon, label, isActive, onClick }) => (
    <li
        onClick={onClick}
        className={`flex items-center p-3 my-1 rounded-lg cursor-pointer transition-colors duration-200 ${
            isActive
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-slate-400 hover:bg-slate-700 hover:text-white'
        }`}
    >
        {icon}
        <span className="ml-4 font-medium">{label}</span>
    </li>
);

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => {
  const navItems = [
    { view: 'dashboard', label: '대시보드', Icon: DashboardIcon },
    { view: 'contractManagement', label: '계약 관리', Icon: ContractsIcon },
    { view: 'deductionManagement', label: '일차감 관리', Icon: DeductionIcon },
    { view: 'shippingManagement', label: '조달 및 배송 현황', Icon: ShippingIcon },
    { view: 'settlementManagement', label: '정산 관리', Icon: SettlementIcon },
    { view: 'creditorSettlementData', label: '채권사 정산 데이터', Icon: CreditorDataIcon },
    { view: 'partners', label: '파트너사', Icon: PartnersIcon },
    { view: 'calendar', label: '공용 캘린더', Icon: CalendarIcon },
    { view: 'database', label: '환경 설정', Icon: DatabaseIcon },
  ];

  return (
    <aside className="w-64 bg-slate-800 p-4 flex flex-col h-screen fixed top-0 left-0">
      <div className="flex items-center mb-10 p-2">
        <div className="bg-indigo-500 p-2 rounded-lg">
          <ContractsIcon className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-xl font-bold text-white ml-3">리스 관리 시스템</h1>
      </div>
      <nav>
        <ul>
            {navItems.map(({ view, label, Icon }) => (
                <NavItem
                    key={view}
                    icon={<Icon className="w-6 h-6" />}
                    label={label}
                    isActive={currentView === view}
                    onClick={() => onNavigate(view as View)}
                />
            ))}
        </ul>
      </nav>
      <div className="mt-auto p-2">
        <div className="bg-slate-700 rounded-lg p-4 text-center">
            <p className="text-sm text-slate-400">BLQ inc.</p>
            <p className="text-xs text-slate-500 mt-1">&copy; 2019. All rights reserved.</p>
        </div>
      </div>
    </aside>
  );
};
