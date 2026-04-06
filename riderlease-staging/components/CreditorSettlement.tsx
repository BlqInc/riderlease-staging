import React, { useState, useMemo } from 'react';
import { Contract, Creditor, CreditorSettlementRound } from '../types';
import { formatCurrency, formatDate } from '../lib/utils';
import { PlusIcon, EditIcon, TrashIcon } from './icons/IconComponents';
import { CreditorSettlementFormModal } from './CreditorSettlementFormModal';

interface CreditorSettlementProps {
  contracts: Contract[];
  creditors: Creditor[];
  settlements: CreditorSettlementRound[];
  onSaveSettlement: (data: Omit<CreditorSettlementRound, 'id' | 'created_at'> & { id?: string }) => void;
  onDeleteSettlement: (id: string) => void;
  onSaveCreditor: (name: string) => void;
  onDeleteCreditor: (id: string) => void;
}

export const CreditorSettlement: React.FC<CreditorSettlementProps> = ({
  contracts, creditors, settlements, onSaveSettlement, onDeleteSettlement, onSaveCreditor, onDeleteCreditor,
}) => {
  const [selectedCreditorId, setSelectedCreditorId] = useState<string>(creditors[0]?.id || '');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<Partial<CreditorSettlementRound> | null>(null);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [showCreditorMgmt, setShowCreditorMgmt] = useState(false);
  const [newCreditorName, setNewCreditorName] = useState('');

  // 선택된 채권사 정보
  const selectedCreditor = useMemo(() => creditors.find(c => c.id === selectedCreditorId), [creditors, selectedCreditorId]);
  const creditorName = selectedCreditor?.name || '채권사';

  // 선택된 채권사의 정산 차수만 필터
  const filteredSettlements = useMemo(() =>
    settlements
      .filter(s => s.creditor_id === selectedCreditorId)
      .sort((a, b) => b.settlement_round - a.settlement_round),
    [settlements, selectedCreditorId]
  );

  // 정산 총액 계산 (해당 채권사 + 해당 차수)
  const getSettlementTotal = (roundNumber: number) => {
    const roundContracts = contracts.filter(c => c.creditor_id === selectedCreditorId && c.settlement_round === roundNumber);
    return roundContracts.reduce((sum, c) => {
      const units = c.units_required || 1;
      if (c.contract_initial_deduction && c.contract_initial_deduction > 0) {
        return sum + (c.contract_initial_deduction * units);
      }
      return sum + c.daily_deduction;
    }, 0);
  };

  // 오늘의 정산 총액
  const todaysTotalSettlementAmount = useMemo(() => {
    const localToday = new Date();
    const todayUTC = new Date(Date.UTC(localToday.getUTCFullYear(), localToday.getUTCMonth(), localToday.getUTCDate()));

    return filteredSettlements.reduce((total, settlement) => {
      const startParts = settlement.start_date.split('-').map(Number);
      const startDateUTC = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
      const endParts = settlement.end_date.split('-').map(Number);
      const endDateUTC = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2]));

      if (todayUTC >= startDateUTC && todayUTC <= endDateUTC) {
        return total + getSettlementTotal(settlement.settlement_round);
      }
      return total;
    }, 0);
  }, [filteredSettlements, contracts, selectedCreditorId]);

  const selectedSettlement = useMemo(() => {
    if (!selectedSettlementId) return null;
    return filteredSettlements.find(s => s.id === selectedSettlementId) || null;
  }, [selectedSettlementId, filteredSettlements]);

  const contractsForSelectedRound = useMemo(() => {
    if (!selectedSettlement) return [];
    return contracts.filter(c => c.creditor_id === selectedCreditorId && c.settlement_round === selectedSettlement.settlement_round);
  }, [selectedSettlement, contracts, selectedCreditorId]);

  const handleOpenModal = (settlement?: CreditorSettlementRound) => {
    setEditingSettlement(settlement || null);
    setIsModalOpen(true);
  };

  const handleSave = (data: Omit<CreditorSettlementRound, 'id' | 'created_at' | 'total_daily_deduction_amount' | 'creditor_id'> & { id?: string }) => {
    const contractsForRound = contracts.filter(c => c.creditor_id === selectedCreditorId && c.settlement_round === data.settlement_round);
    const total_daily_deduction_amount = contractsForRound.reduce((sum, c) => {
      const units = c.units_required || 1;
      if (c.contract_initial_deduction && c.contract_initial_deduction > 0) {
        return sum + (c.contract_initial_deduction * units);
      }
      return sum + c.daily_deduction;
    }, 0);
    onSaveSettlement({ ...data, creditor_id: selectedCreditorId, total_daily_deduction_amount });
    setIsModalOpen(false);
    setEditingSettlement(null);
  };

  const handleAddCreditor = () => {
    const name = newCreditorName.trim();
    if (!name) return;
    if (creditors.some(c => c.name === name)) { alert('이미 존재하는 채권사입니다.'); return; }
    onSaveCreditor(name);
    setNewCreditorName('');
  };

  // 채권사 변경 시 선택된 정산 차수 초기화
  const handleCreditorChange = (id: string) => {
    setSelectedCreditorId(id);
    setSelectedSettlementId(null);
  };

  return (
    <>
      <div className="p-8">
        {/* 헤더 */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <h2 className="text-3xl font-bold text-white">채권사 정산 관리</h2>
            <select
              value={selectedCreditorId}
              onChange={(e) => handleCreditorChange(e.target.value)}
              className="bg-slate-700 text-white rounded-lg px-4 py-2 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {creditors.filter(c => c.is_active).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => setShowCreditorMgmt(!showCreditorMgmt)}
              className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-slate-700 transition-colors"
              title="채권사 관리"
            >
              {showCreditorMgmt ? '닫기' : '채권사 관리'}
            </button>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-md"
          >
            <PlusIcon className="w-5 h-5 mr-2" />
            신규 정산 차수 추가
          </button>
        </div>

        {/* 채권사 관리 패널 */}
        {showCreditorMgmt && (
          <div className="bg-slate-800 rounded-lg p-4 mb-6 border border-slate-700">
            <h4 className="text-white font-semibold mb-3">채권사 목록 관리</h4>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newCreditorName}
                onChange={(e) => setNewCreditorName(e.target.value)}
                placeholder="새 채권사 이름"
                className="bg-slate-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 max-w-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleAddCreditor()}
              />
              <button onClick={handleAddCreditor} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-4 py-1.5 rounded-lg transition-colors">추가</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {creditors.map(c => (
                <div key={c.id} className="flex items-center gap-1.5 bg-slate-700 rounded-lg px-3 py-1.5">
                  <span className="text-white text-sm">{c.name}</span>
                  <button
                    onClick={() => { if (confirm(`"${c.name}" 채권사를 삭제하시겠습니까?`)) onDeleteCreditor(c.id); }}
                    className="text-red-400 hover:text-red-300 text-xs ml-1"
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 좌측: 정산 차수 목록 */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-slate-800 p-4 rounded-lg border border-green-700 shadow-lg">
              <p className="text-sm font-semibold text-green-300">오늘의 {creditorName} 정산 총액</p>
              <p className="text-3xl font-bold text-white mt-1">{formatCurrency(todaysTotalSettlementAmount)}</p>
              <p className="text-xs text-slate-500 mt-1">{formatDate(new Date().toISOString())} 기준 (실시간 집계)</p>
            </div>

            <div>
              <h3 className="text-xl font-semibold text-white my-2">정산 차수 목록</h3>
              {filteredSettlements.length === 0 && <p className="text-slate-400">등록된 정산 차수가 없습니다.</p>}
              <div className="space-y-3">
                {filteredSettlements.map(s => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSettlementId(s.id)}
                    className={`p-4 rounded-lg cursor-pointer transition-all border ${selectedSettlementId === s.id ? 'bg-indigo-900/50 border-indigo-600' : 'bg-slate-800 hover:bg-slate-700/50 border-slate-700'}`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-lg text-white">{s.settlement_round}차 정산</h4>
                        <p className="text-sm text-slate-400">{formatDate(s.start_date)} ~ {formatDate(s.end_date)}</p>
                      </div>
                      <div className="flex space-x-2">
                        <button onClick={(e) => { e.stopPropagation(); handleOpenModal(s); }} className="p-1 text-yellow-400 hover:text-yellow-300"><EditIcon className="w-4 h-4" /></button>
                        <button onClick={(e) => { e.stopPropagation(); if (confirm('삭제하시겠습니까?')) onDeleteSettlement(s.id); }} className="p-1 text-red-400 hover:text-red-300"><TrashIcon className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-700">
                      <p className="text-sm text-slate-400">일일 총 차감액 (실시간)</p>
                      <p className="font-bold text-xl text-yellow-400">{formatCurrency(getSettlementTotal(s.settlement_round))}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 우측: 상세 정보 */}
          <div className="lg:col-span-2">
            {selectedSettlement ? (
              <div className="bg-slate-800 rounded-lg p-6 animate-fade-in">
                <h3 className="text-2xl font-bold text-white mb-4">{creditorName} {selectedSettlement.settlement_round}차 정산 상세 정보</h3>
                <div className="bg-slate-900/50 p-4 rounded-lg mb-6 space-y-2">
                  <p><span className="font-semibold text-slate-400">정산 기간:</span> <span className="text-white">{formatDate(selectedSettlement.start_date)} ~ {formatDate(selectedSettlement.end_date)}</span></p>
                  <p><span className="font-semibold text-slate-400">일일 총 차감액:</span> <span className="font-bold text-2xl text-yellow-400 ml-2">{formatCurrency(getSettlementTotal(selectedSettlement.settlement_round))}</span></p>
                  <p><span className="font-semibold text-slate-400">포함된 계약 수:</span> <span className="text-white">{contractsForSelectedRound.length}건</span></p>
                </div>

                <div>
                  <h4 className="font-semibold text-white mb-3">포함된 계약 목록</h4>
                  <div className="overflow-x-auto max-h-[60vh] border border-slate-700 rounded-lg">
                    <table className="w-full text-left">
                      <thead className="bg-slate-700/50 sticky top-0">
                        <tr>
                          <th className="p-3 font-semibold text-slate-400 text-sm">총판명</th>
                          <th className="p-3 font-semibold text-slate-400 text-sm">계약자</th>
                          <th className="p-3 font-semibold text-slate-400 text-sm">기기명</th>
                          <th className="p-3 font-semibold text-slate-400 text-sm text-center">수량</th>
                          <th className="p-3 font-semibold text-slate-400 text-sm text-right">일차감액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contractsForSelectedRound.map(c => {
                          const units = c.units_required || 1;
                          let deductionAmount: number, basis: string;
                          if (c.contract_initial_deduction && c.contract_initial_deduction > 0) {
                            deductionAmount = c.contract_initial_deduction * units;
                            basis = '계약서 기준액';
                          } else {
                            deductionAmount = c.daily_deduction;
                            basis = '기본 일차감액';
                          }
                          return (
                            <tr key={c.id} className="border-b border-slate-700 last:border-b-0">
                              <td className="p-3 text-sm">{c.distributor_name || 'N/A'}</td>
                              <td className="p-3 text-sm font-medium text-white">{c.lessee_name || 'N/A'}</td>
                              <td className="p-3 text-sm">{c.device_name}</td>
                              <td className="p-3 text-sm text-center">{units}</td>
                              <td className="p-3 text-sm text-right">
                                <div className="font-semibold text-green-300">{formatCurrency(deductionAmount)}</div>
                                <div className="text-xs text-slate-500">{basis}</div>
                              </td>
                            </tr>
                          );
                        })}
                        {contractsForSelectedRound.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-slate-400">이 정산 차수에 포함된 계약이 없습니다.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-800 rounded-lg p-12 text-center h-full flex items-center justify-center">
                <p className="text-slate-400">왼쪽 목록에서 정산 차수를 선택하여 상세 정보를 확인하세요.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <CreditorSettlementFormModal
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setEditingSettlement(null); }}
          onSave={handleSave}
          settlementToEdit={editingSettlement}
          creditorName={creditorName}
        />
      )}
    </>
  );
};
