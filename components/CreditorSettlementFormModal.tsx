import React, { useState, useEffect, useMemo } from 'react';
import { CreditorSettlementRound } from '../types';
import { CloseIcon } from './icons/IconComponents';

interface CreditorSettlementFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<CreditorSettlementRound, 'id' | 'created_at' | 'total_daily_deduction_amount' | 'creditor_id'> & { id?: string }) => void;
  settlementToEdit: Partial<CreditorSettlementRound> | null;
  creditorName: string;
}

const addDays = (dateStr: string, days: number): string => {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().split('T')[0];
};

export const CreditorSettlementFormModal: React.FC<CreditorSettlementFormModalProps> = ({
  isOpen, onClose, onSave, settlementToEdit, creditorName,
}) => {
  const [settlement_round, setSettlementRound] = useState<number | ''>('');
  const [start_date, setStartDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSettlementRound(settlementToEdit?.settlement_round || '');
      setStartDate(settlementToEdit?.start_date || '');
    }
  }, [settlementToEdit, isOpen]);

  // 자동 계산
  const end_date_180 = useMemo(() => start_date ? addDays(start_date, 180) : '', [start_date]);
  const end_date_210 = useMemo(() => start_date ? addDays(start_date, 210) : '', [start_date]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (settlement_round === '' || !start_date) {
      alert('정산 차수와 시작일을 입력해주세요.');
      return;
    }
    const saveData: any = {
      settlement_round: Number(settlement_round),
      start_date,
      end_date: end_date_210, // 카드 표시용: 210일 기준 (더 긴 쪽)
      end_date_180,
      end_date_210,
    };
    if (settlementToEdit?.id) saveData.id = settlementToEdit.id;
    onSave(saveData);
    onClose();
  };

  const titleText = settlementToEdit?.id ? `${creditorName} 정산 차수 수정` : `${creditorName} 신규 정산 차수 추가`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">{titleText}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-6">
            <div>
              <label htmlFor="settlement_round" className="block text-sm font-medium text-slate-400 mb-2">정산 차수</label>
              <input
                id="settlement_round" type="number" value={settlement_round}
                onChange={(e) => setSettlementRound(Number(e.target.value))}
                placeholder="숫자로 입력 (예: 1)"
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required autoFocus
              />
            </div>
            <div>
              <label htmlFor="start_date" className="block text-sm font-medium text-slate-400 mb-2">정산 시작일</label>
              <input
                id="start_date" type="date" value={start_date}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
            {/* 자동 계산된 종료일 표시 */}
            {start_date && (
              <div className="bg-slate-900/50 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-slate-400">자동 계산된 종료일</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-blue-400 font-medium">180일 계약 종료</p>
                    <p className="text-lg font-bold text-white mt-1">{end_date_180}</p>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3">
                    <p className="text-xs text-purple-400 font-medium">210일 계약 종료</p>
                    <p className="text-lg font-bold text-white mt-1">{end_date_210}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
          <footer className="p-6 bg-slate-800/50 flex justify-end items-center">
            <div className="flex space-x-4">
              <button type="button" onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">취소</button>
              <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">저장</button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
};
