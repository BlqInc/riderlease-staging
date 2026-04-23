

import React, { useMemo, useState, useEffect, useCallback, memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Contract, Partner, DeductionStatus, ContractStatus } from '../types';
import { formatDate, formatCurrency } from '../lib/utils';
import { exportToCsv } from '../lib/csvUtils';
import { CloseIcon, DownloadIcon } from './icons/IconComponents';

type ActiveTab = '전체' | '고소건';

interface DeductionManagementProps {
  contracts: Contract[];
  partners: Partner[];
  onAddPayment: (contractId: string, amount: number) => void;
  onSettleDeduction: (contractId: string, deductionId: string) => void;
  onCancelDeduction: (contractId: string, deductionId: string) => void;
  onToggleLawsuit: (contractId: string) => void;
  onBulkSettleDeductions: (contractId: string, deductionIds: string[]) => void;
  onBulkCancelDeductions: (contractId: string, deductionIds: string[]) => void;
  onBulkDistributorPayment?: (distributorName: string, dateFrom: string, dateTo: string, inputAmount: number, excludeContractIds: string[]) => Promise<{ processed: number; remaining: number } | undefined>;
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

// Props에서 contractId를 받아 stable 콜백과 결합 → memo 효과 극대화
const ContractDeductionCard = memo<{
  contract: Contract;
  partnerName: string;
  isOpen: boolean;
  onToggle: (contractId: string) => void;
  onOpenPaymentModal: (contract: Contract) => void;
  onSettleDeduction: (contractId: string, deductionId: string) => void;
  onCancelDeduction: (contractId: string, deductionId: string) => void;
  onToggleLawsuit: (contractId: string) => void;
  onBulkSettle: (contractId: string, deductionIds: string[]) => void;
  onBulkCancel: (contractId: string, deductionIds: string[]) => void;
}>(({ contract, partnerName, isOpen, onToggle, onOpenPaymentModal, onSettleDeduction, onCancelDeduction, onToggleLawsuit, onBulkSettle, onBulkCancel }) => {

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) setCheckedIds(new Set());
  }, [isOpen]);

  const { balance, sortedDeductions } = useMemo(() => {
    const deductions = contract.daily_deductions || [];
    // 차감 단위로 미납액 합산 (음수 방지 + 데이터 이상 시에도 정확)
    // 이전: contract.total_amount - paid → 데이터 이상 계약에서 음수 발생
    const remaining = deductions.reduce(
      (sum, d) => sum + Math.max((d.amount || 0) - (d.paid_amount || 0), 0),
      0
    );
    // YYYY-MM-DD 형식은 문자열 비교로 날짜 정렬 가능 → Date 객체 생성 불필요
    const sorted = [...deductions].sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
    return { balance: remaining, sortedDeductions: sorted };
  }, [contract.daily_deductions]);

  // 체크된 항목 중 미납/부분납부 건수, 완납 건수 계산
  const { checkedUnpaidCount, checkedPaidCount } = useMemo(() => {
    let unpaid = 0;
    let paid = 0;
    for (const d of sortedDeductions) {
      if (!checkedIds.has(d.id)) continue;
      if (d.status === DeductionStatus.PAID) paid++;
      else unpaid++;
    }
    return { checkedUnpaidCount: unpaid, checkedPaidCount: paid };
  }, [checkedIds, sortedDeductions]);

  const toggleCheck = useCallback((id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleClick = useCallback(() => {
    onToggle(contract.id);
  }, [contract.id, onToggle]);

  const handleLawsuitClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleLawsuit(contract.id);
  }, [contract.id, onToggleLawsuit]);

  const handlePaymentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenPaymentModal(contract);
  }, [contract, onOpenPaymentModal]);

  const handleBulkSettle = useCallback(() => {
    const unpaidIds = sortedDeductions
      .filter(d => checkedIds.has(d.id) && d.status !== DeductionStatus.PAID)
      .map(d => d.id);
    if (unpaidIds.length === 0) return;
    onBulkSettle(contract.id, unpaidIds);
    setCheckedIds(new Set());
  }, [checkedIds, sortedDeductions, contract.id, onBulkSettle]);

  const handleBulkCancel = useCallback(() => {
    const paidIds = sortedDeductions
      .filter(d => checkedIds.has(d.id) && d.status === DeductionStatus.PAID)
      .map(d => d.id);
    if (paidIds.length === 0) return;
    onBulkCancel(contract.id, paidIds);
    setCheckedIds(new Set());
  }, [checkedIds, sortedDeductions, contract.id, onBulkCancel]);

  // 가상 스크롤: 보이는 항목만 렌더링 (365개 → ~5개)
  const deductionListRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: sortedDeductions.length,
    getScrollElement: () => deductionListRef.current,
    estimateSize: () => 72, // 항목 높이 추정값 (px)
    overscan: 3,            // 화면 밖 미리 렌더 개수
    getItemKey: (index) => sortedDeductions[index].id,
  });

  return (
    <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden transition-all duration-300">
      <div
        className="flex justify-between items-center p-4 cursor-pointer hover:bg-slate-700/50"
        onClick={handleToggleClick}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-white text-lg">[#<span className="text-indigo-400">{contract.contract_number}</span>] - {contract.distributor_name || '총판 없음'} / {contract.lessee_name}</p>
            {contract.is_lawsuit && (
              <span className="px-2 py-0.5 text-xs font-bold bg-red-600/30 text-red-300 border border-red-500/50 rounded-full">고소건</span>
            )}
          </div>
          <p className="text-sm text-slate-400">{contract.device_name} / {partnerName}</p>
        </div>
        <div className="flex-1 text-right px-4">
          <p className="text-sm text-slate-400" title="오늘까지 청구된 차감 중 아직 받지 못한 금액">오늘까지 미납액</p>
          <p className={`font-bold text-xl ${contract.unpaid_balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
            {formatCurrency(contract.unpaid_balance)}
          </p>
        </div>
        <div className="flex-1 text-right px-4">
          <p className="text-sm text-slate-400" title="만기일까지 모든 차감 합 중 아직 받지 못한 금액 (미래 차감 포함)">잔여 미수액</p>
          <p className="font-bold text-xl text-yellow-400">{formatCurrency(balance)}</p>
        </div>
        <div className="flex items-center space-x-2 px-4">
          <button
            onClick={handleLawsuitClick}
            className={`text-xs font-bold py-1.5 px-3 rounded-lg transition-colors ${
              contract.is_lawsuit
                ? 'bg-red-700 hover:bg-red-800 text-white'
                : 'bg-slate-600 hover:bg-slate-500 text-slate-300'
            }`}
          >
            {contract.is_lawsuit ? '고소건 해제' : '고소건 지정'}
          </button>
          <button
            onClick={handlePaymentClick}
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
          <div className="flex justify-between items-center mb-3 px-2">
            <h4 className="font-bold text-white">일일 차감 내역</h4>
            <div className="flex gap-2">
              {checkedUnpaidCount > 0 && (
                <button
                  onClick={handleBulkSettle}
                  className="bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-1.5 px-4 rounded-lg transition-colors"
                >
                  선택 {checkedUnpaidCount}건 전액 처리
                </button>
              )}
              {checkedPaidCount > 0 && (
                <button
                  onClick={handleBulkCancel}
                  className="bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-bold py-1.5 px-4 rounded-lg transition-colors"
                >
                  선택 {checkedPaidCount}건 납부 취소
                </button>
              )}
            </div>
          </div>
          {sortedDeductions.length > 0 ? (
            <div ref={deductionListRef} className="max-h-80 overflow-y-auto pr-2">
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map(virtualItem => {
                  const deduction = sortedDeductions[virtualItem.index];
                  return (
                    <div
                      key={virtualItem.key}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                        paddingBottom: '8px',
                      }}
                    >
                      <div className={`flex justify-between items-center p-3 rounded-md transition-colors ${checkedIds.has(deduction.id) ? 'bg-indigo-900/40 border border-indigo-500/50' : 'bg-slate-700/80'}`}>
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={checkedIds.has(deduction.id)}
                            onChange={() => toggleCheck(deduction.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 accent-indigo-500 cursor-pointer flex-shrink-0"
                          />
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
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-center text-slate-400 py-4">생성된 일차감 내역이 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
});


export const DeductionManagement: React.FC<DeductionManagementProps> = ({
  contracts, partners,
  onAddPayment, onSettleDeduction, onCancelDeduction,
  onToggleLawsuit, onBulkSettleDeductions, onBulkCancelDeductions,
  onBulkDistributorPayment,
}) => {
  const [openContractId, setOpenContractId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentModalContract, setPaymentModalContract] = useState<Contract | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('전체');

  // 총판별 일괄 납부 모달
  const [bulkPayModal, setBulkPayModal] = useState<{ partnerIds: string[]; partnerNames: string[] } | null>(null);
  const [bulkPayForm, setBulkPayForm] = useState({ dateFrom: '', dateTo: '', amount: '' });
  const [bulkPayExclude, setBulkPayExclude] = useState<Set<string>>(new Set());
  const [bulkPayProcessing, setBulkPayProcessing] = useState(false);
  const [bulkPayResult, setBulkPayResult] = useState<{ processed: number; remaining: number } | null>(null);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Set<string>>(new Set());
  const [partnerDropdownOpen, setPartnerDropdownOpen] = useState(false);
  const outerListRef = useRef<HTMLDivElement>(null);

  const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);

  const contractsToList = useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    const filtered = contracts.filter(c => {
      const partnerName = partnerMap.get(c.partner_id) || '';
      const searchMatch = !lowerSearch ||
        (c.device_name || '').toLowerCase().includes(lowerSearch) ||
        partnerName.toLowerCase().includes(lowerSearch) ||
        (c.lessee_name || '').toLowerCase().includes(lowerSearch) ||
        (c.distributor_name || '').toLowerCase().includes(lowerSearch);

      const statusMatch =
        c.status === ContractStatus.ACTIVE ||
        c.status === ContractStatus.SETTLED ||
        (c.status === ContractStatus.EXPIRED && c.unpaid_balance > 0);

      const tabMatch = activeTab === '고소건' ? !!c.is_lawsuit : !c.is_lawsuit;

      return statusMatch && searchMatch && tabMatch;
    });
    return filtered.sort((a, b) => (b.unpaid_balance || 0) - (a.unpaid_balance || 0));
  }, [contracts, partnerMap, searchTerm, activeTab]);

  const outerVirtualizer = useVirtualizer({
    count: contractsToList.length,
    getScrollElement: () => outerListRef.current,
    estimateSize: () => 80,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (index) => contractsToList[index].id,
  });

  const summary = useMemo(() => {
    return contractsToList.reduce(
      (acc, contract) => {
        const totalPaid = (contract.daily_deductions || []).reduce((sum, d) => sum + d.paid_amount, 0);
        acc.totalUnpaid += contract.unpaid_balance;
        acc.totalBalance += contract.total_amount - totalPaid;
        acc.totalDailyDeduction += contract.daily_deduction;
        return acc;
      },
      { totalUnpaid: 0, totalBalance: 0, totalDailyDeduction: 0 }
    );
  }, [contractsToList]);

  const lawsuitCount = useMemo(() => contracts.filter(c => !!c.is_lawsuit).length, [contracts]);

  // stable 콜백 → React.memo 효과 유지
  const handleToggleCard = useCallback((contractId: string) => {
    setOpenContractId(prevId => (prevId === contractId ? null : contractId));
  }, []);

  const handleOpenPaymentModal = useCallback((contract: Contract) => {
    setPaymentModalContract(contract);
  }, []);

  const handleClosePaymentModal = useCallback(() => {
    setPaymentModalContract(null);
  }, []);

  const handlePaymentSubmit = useCallback((amount: number) => {
    setPaymentModalContract(prev => {
      if (prev) onAddPayment(prev.id, amount);
      return null;
    });
  }, [onAddPayment]);

  const handleExport = useCallback(() => {
    const header = ['계약번호', '파트너사', '총판명', '계약자', '기기명', '차감일', '차감액', '납부액', '미납액', '상태'];
    const relevantContracts = contracts.filter(c => c.status === ContractStatus.ACTIVE || c.status === ContractStatus.SETTLED);
    const rows = relevantContracts.flatMap(c =>
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
        d.status,
      ])
    );
    exportToCsv(`일차감_전체내역_${new Date().toISOString().split('T')[0]}.csv`, [header, ...rows]);
  }, [contracts, partnerMap]);

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

      {/* 탭 */}
      <div className="flex space-x-1 mb-4 bg-slate-800 p-1 rounded-lg w-fit">
        {(['전체', '고소건'] as ActiveTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-md text-sm font-semibold transition-colors flex items-center gap-2 ${
              activeTab === tab ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab}
            {tab === '고소건' && lawsuitCount > 0 && (
              <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">{lawsuitCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 bg-slate-800 p-4 rounded-lg mb-6">
        <input
          type="text"
          placeholder="총판명, 계약자명, 기기명, 파트너사 검색..."
          className="bg-slate-700 text-white placeholder-slate-400 rounded-lg px-4 py-2 flex-1 max-w-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {onBulkDistributorPayment && (
          <div className="flex items-center gap-2 relative">
            {/* 파트너사 체크박스 드롭다운 */}
            <div className="relative">
              <button
                onClick={() => setPartnerDropdownOpen(!partnerDropdownOpen)}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[180px] text-left flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {selectedPartnerIds.size === 0
                    ? '파트너사 선택'
                    : `${selectedPartnerIds.size}개 선택됨`}
                </span>
                <svg className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${partnerDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {partnerDropdownOpen && (
                <div className="absolute top-full mt-1 left-0 bg-slate-700 border border-slate-600 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto min-w-[220px]">
                  <div className="p-2 border-b border-slate-600 flex gap-2">
                    <button onClick={() => setSelectedPartnerIds(new Set(partners.map(p => p.id)))} className="text-xs text-indigo-400 hover:text-indigo-300">전체 선택</button>
                    <button onClick={() => setSelectedPartnerIds(new Set())} className="text-xs text-slate-400 hover:text-slate-300">전체 해제</button>
                  </div>
                  {partners.map(p => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-600/50 cursor-pointer">
                      <input type="checkbox" checked={selectedPartnerIds.has(p.id)}
                        onChange={() => setSelectedPartnerIds(prev => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                          return next;
                        })}
                        className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-800 text-indigo-600" />
                      <span className="text-sm text-white">{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                if (selectedPartnerIds.size === 0) { alert('파트너사를 선택해주세요.'); return; }
                const partnerIds = Array.from(selectedPartnerIds);
                const partnerNames = partnerIds.map(id => partners.find(p => p.id === id)?.name || '');
                setBulkPayModal({ partnerIds, partnerNames });
                setBulkPayForm({ dateFrom: '', dateTo: '', amount: '' });
                setBulkPayExclude(new Set());
                setBulkPayResult(null);
                setPartnerDropdownOpen(false);
              }}
              disabled={selectedPartnerIds.size === 0}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
            >
              일괄 납부 ({selectedPartnerIds.size})
            </button>
          </div>
        )}
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

      {contractsToList.length === 0 ? (
        <div className="bg-slate-800 rounded-lg shadow-lg p-8 text-center text-slate-400">
          <p>관리할 일차감 내역이 없거나 검색 결과가 없습니다.</p>
        </div>
      ) : (
        <div ref={outerListRef} className="h-[calc(100vh-380px)] overflow-y-auto">
          <div style={{ height: `${outerVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {outerVirtualizer.getVirtualItems().map(virtualItem => {
              const contract = contractsToList[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={outerVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                    paddingBottom: '16px',
                  }}
                >
                  <ContractDeductionCard
                    contract={contract}
                    partnerName={partnerMap.get(contract.partner_id) || '알 수 없음'}
                    isOpen={openContractId === contract.id}
                    onToggle={handleToggleCard}
                    onOpenPaymentModal={handleOpenPaymentModal}
                    onSettleDeduction={onSettleDeduction}
                    onCancelDeduction={onCancelDeduction}
                    onToggleLawsuit={onToggleLawsuit}
                    onBulkSettle={onBulkSettleDeductions}
                    onBulkCancel={onBulkCancelDeductions}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {paymentModalContract && (
        <PaymentModal
          isOpen={!!paymentModalContract}
          onClose={handleClosePaymentModal}
          onSubmit={handlePaymentSubmit}
          contract={paymentModalContract}
        />
      )}

      {/* 총판 일괄 납부 모달 */}
      {bulkPayModal && onBulkDistributorPayment && (() => {
        const today = new Date().toISOString().slice(0, 10);
        const partnerIdSet = new Set(bulkPayModal.partnerIds);
        const distContracts = contracts.filter(c =>
          partnerIdSet.has(c.partner_id) &&
          c.status === '진행중' &&
          (!c.execution_date || c.execution_date <= today)
        );
        const inputAmt = Number(bulkPayForm.amount) || 0;
        const expectedTotal = distContracts
          .filter(c => !bulkPayExclude.has(c.id))
          .reduce((sum, c) => {
            if (!bulkPayForm.dateFrom || !bulkPayForm.dateTo) return sum;
            const days = (c.daily_deductions || []).filter(d =>
              d.date >= bulkPayForm.dateFrom && d.date <= bulkPayForm.dateTo && d.status !== '납부완료'
            ).reduce((s, d) => s + (d.amount - d.paid_amount), 0);
            if (!c.daily_deductions || c.daily_deductions.length === 0) {
              const from = new Date(bulkPayForm.dateFrom);
              const to = new Date(bulkPayForm.dateTo);
              const numDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
              return sum + (c.daily_deduction || 0) * numDays;
            }
            return sum + days;
          }, 0);
        const diff = inputAmt - expectedTotal;

        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-700">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-white">파트너사 일괄 납부</h2>
                    <p className="text-slate-400 text-sm mt-1">{bulkPayModal.partnerNames.join(', ')} · {distContracts.length}건</p>
                  </div>
                  <button onClick={() => setBulkPayModal(null)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
                </div>
              </div>
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">정산 시작일</label>
                    <input type="date" value={bulkPayForm.dateFrom}
                      onChange={e => setBulkPayForm(p => ({ ...p, dateFrom: e.target.value }))}
                      className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">정산 종료일</label>
                    <input type="date" value={bulkPayForm.dateTo}
                      onChange={e => setBulkPayForm(p => ({ ...p, dateTo: e.target.value }))}
                      className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">입금액</label>
                    <input type="number" value={bulkPayForm.amount} placeholder="0"
                      onChange={e => setBulkPayForm(p => ({ ...p, amount: e.target.value }))}
                      className="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
                {bulkPayForm.dateFrom && bulkPayForm.dateTo && (
                  <div className="grid grid-cols-3 gap-3 bg-slate-900/50 rounded-lg p-4">
                    <div><p className="text-xs text-slate-400">예상 청구액</p><p className="text-lg font-bold text-white">{formatCurrency(expectedTotal)}</p></div>
                    <div><p className="text-xs text-slate-400">입금액</p><p className="text-lg font-bold text-white">{formatCurrency(inputAmt)}</p></div>
                    <div><p className="text-xs text-slate-400">차액</p>
                      <p className={`text-lg font-bold ${diff === 0 ? 'text-green-400' : diff > 0 ? 'text-blue-400' : 'text-red-400'}`}>{diff === 0 ? '일치' : formatCurrency(diff)}</p></div>
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-300 mb-2">포함 계약 ({distContracts.length - bulkPayExclude.size}건)</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {distContracts.map(c => (
                      <label key={c.id} className={`flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700/50 cursor-pointer ${bulkPayExclude.has(c.id) ? 'opacity-40' : ''}`}>
                        <input type="checkbox" checked={!bulkPayExclude.has(c.id)}
                          onChange={() => setBulkPayExclude(prev => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                          className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600" />
                        <span className="text-sm text-white flex-1">{c.lessee_name || '미지정'}</span>
                        <span className="text-xs text-slate-500">{c.distributor_name}</span>
                        <span className="text-xs text-slate-400">{c.device_name}</span>
                        <span className="text-xs text-slate-400">{formatCurrency(c.daily_deduction)}/일</span>
                      </label>
                    ))}
                  </div>
                </div>
                {bulkPayResult && (
                  <div className={`rounded-lg p-4 ${bulkPayResult.remaining === 0 ? 'bg-green-900/30 border border-green-700/50' : 'bg-yellow-900/30 border border-yellow-700/50'}`}>
                    <p className="text-sm font-semibold text-white">처리 완료: {bulkPayResult.processed}건 계약 납부 반영</p>
                    {bulkPayResult.remaining > 0 && <p className="text-xs text-yellow-300 mt-1">미배분 잔액: {formatCurrency(bulkPayResult.remaining)}</p>}
                  </div>
                )}
              </div>
              <div className="p-6 border-t border-slate-700 flex justify-end gap-3">
                <button onClick={() => setBulkPayModal(null)} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">닫기</button>
                {!bulkPayResult ? (
                  <button onClick={async () => {
                      if (!bulkPayForm.dateFrom || !bulkPayForm.dateTo) { alert('정산 기간을 입력해주세요.'); return; }
                      if (!inputAmt) { alert('입금액을 입력해주세요.'); return; }
                      setBulkPayProcessing(true);
                      const result = await onBulkDistributorPayment(bulkPayModal.partnerIds.join(','), bulkPayForm.dateFrom, bulkPayForm.dateTo, inputAmt, Array.from(bulkPayExclude));
                      setBulkPayResult(result || { processed: 0, remaining: inputAmt });
                      setBulkPayProcessing(false);
                    }}
                    disabled={bulkPayProcessing || !bulkPayForm.dateFrom || !bulkPayForm.dateTo || !inputAmt}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                  >{bulkPayProcessing ? '처리 중...' : inputAmt === expectedTotal ? '전액 납부 처리' : '입금액 기준 처리'}</button>
                ) : (
                  <button onClick={() => setBulkPayModal(null)} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">확인</button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
