
import React, { useState, useEffect } from 'react';
import { GreenwichSettlement } from '../types';
import { CloseIcon } from './icons/IconComponents';

interface GreenwichSettlementFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Omit<GreenwichSettlement, 'id' | 'created_at' | 'total_daily_deduction_amount'> & { id?: string, total_daily_deduction_amount?: number }) => void;
  settlementToEdit: Partial<GreenwichSettlement> | null;
}

export const GreenwichSettlementFormModal: React.FC<GreenwichSettlementFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  settlementToEdit,
}) => {
  const [settlement_round, setSettlementRound] = useState<number | ''>('');
  const [start_date, setStartDate] = useState('');
  const [end_date, setEndDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSettlementRound(settlementToEdit?.settlement_round || '');
      setStartDate(settlementToEdit?.start_date || '');
      setEndDate(settlementToEdit?.end_date || '');
    }
  }, [settlementToEdit, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (settlement_round === '' || !start_date || !end_date) {
      alert('모든 필드를 입력해주세요.');
      return;
    }
    
    const saveData: Omit<GreenwichSettlement, 'id' | 'created_at' | 'total_daily_deduction_amount'> & { id?: string } = {
      settlement_round: Number(settlement_round),
      start_date,
      end_date,
    };

    if (settlementToEdit?.id) {
      saveData.id = settlementToEdit.id;
    }

    onSave(saveData);
    onClose();
  };
  
  const titleText = settlementToEdit?.id ? '정산 차수 수정' : '신규 정산 차수 추가';

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
                        id="settlement_round"
                        type="number" 
                        value={settlement_round} 
                        onChange={(e) => setSettlementRound(Number(e.target.value))} 
                        placeholder="숫자로 입력 (예: 1)"
                        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                        required
                        autoFocus
                    />
                </div>
                 <div>
                    <label htmlFor="start_date" className="block text-sm font-medium text-slate-400 mb-2">정산 시작일</label>
                    <input 
                        id="start_date"
                        type="date" 
                        value={start_date} 
                        onChange={(e) => setStartDate(e.target.value)} 
                        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                        required
                    />
                </div>
                 <div>
                    <label htmlFor="end_date" className="block text-sm font-medium text-slate-400 mb-2">정산 종료일</label>
                    <input 
                        id="end_date"
                        type="date" 
                        value={end_date} 
                        onChange={(e) => setEndDate(e.target.value)} 
                        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                        required
                    />
                </div>
            </div>
            
            <footer className="p-6 bg-slate-800/50 flex justify-end items-center">
                <div className="flex space-x-4">
                    <button type="button" onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                        취소
                    </button>
                    <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                        저장
                    </button>
                </div>
            </footer>
        </form>
      </div>
    </div>
  );
};
