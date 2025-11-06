import React, { useState, useMemo } from 'react';
import { PriceTier } from '../types';
import { CloseIcon, PlusIcon } from './icons/IconComponents';
import { formatCurrency } from '../lib/utils';

interface PriceListPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  priceList: PriceTier[];
  existingPriceList: PriceTier[];
  onAddTiers: (tiers: PriceTier[]) => void;
}

export const PriceListPickerModal: React.FC<PriceListPickerModalProps> = ({
  isOpen,
  onClose,
  priceList,
  existingPriceList,
  onAddTiers,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const existingTierKeys = useMemo(() => {
    return new Set(
      existingPriceList.map(t => `${t.model}-${t.storage}-${t.durationDays}`)
    );
  }, [existingPriceList]);

  const availableTiers = useMemo(() => {
    return priceList.filter(tier => {
      const key = `${tier.model}-${tier.storage}-${tier.durationDays}`;
      const nameMatch = tier.model.toLowerCase().includes(searchTerm.toLowerCase());
      return !existingTierKeys.has(key) && nameMatch;
    });
  }, [priceList, existingTierKeys, searchTerm]);

  const handleToggleSelection = (tierId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tierId)) {
        newSet.delete(tierId);
      } else {
        newSet.add(tierId);
      }
      return newSet;
    });
  };
  
  const handleSelectAll = () => {
    if(selectedIds.size === availableTiers.length) {
      setSelectedIds(new Set()); // deselect all
    } else {
      setSelectedIds(new Set(availableTiers.map(t => t.id))); // select all
    }
  };

  const handleSubmit = () => {
    const tiersToAdd = priceList.filter(t => selectedIds.has(t.id));
    onAddTiers(tiersToAdd);
  };
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[60] p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">단가표에서 항목 추가</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        <div className="p-6">
          <input
            type="text"
            placeholder="기종으로 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-700 text-white placeholder-slate-400 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
        </div>
        <main className="px-6 pb-6 overflow-y-auto flex-grow">
          <div className="bg-slate-900/50 rounded-lg overflow-hidden border border-slate-700">
            <div className="max-h-[50vh] overflow-y-auto">
                <table className="w-full text-left">
                <thead className="bg-slate-700/50 sticky top-0">
                    <tr>
                    <th className="p-3 text-center w-12">
                        <input 
                        type="checkbox"
                        checked={availableTiers.length > 0 && selectedIds.size === availableTiers.length}
                        onChange={handleSelectAll}
                        className="h-4 w-4 rounded border-slate-500 bg-slate-600 text-indigo-600 focus:ring-indigo-500"
                        />
                    </th>
                    <th className="p-3 font-semibold text-slate-400">기종</th>
                    <th className="p-3 font-semibold text-slate-400">용량</th>
                    <th className="p-3 font-semibold text-slate-400">기간</th>
                    <th className="p-3 font-semibold text-slate-400 text-right">총 채권액</th>
                    <th className="p-3 font-semibold text-slate-400 text-right">일차감</th>
                    </tr>
                </thead>
                <tbody>
                    {availableTiers.map(tier => (
                    <tr key={tier.id} className="border-b border-slate-700 last:border-b-0 hover:bg-slate-700/50 transition-colors">
                        <td className="p-3 text-center">
                        <input
                            type="checkbox"
                            checked={selectedIds.has(tier.id)}
                            onChange={() => handleToggleSelection(tier.id)}
                            className="h-4 w-4 rounded border-slate-500 bg-slate-600 text-indigo-600 focus:ring-indigo-500"
                        />
                        </td>
                        <td className="p-3 font-medium text-white">{tier.model}</td>
                        <td className="p-3">{tier.storage}</td>
                        <td className="p-3">{tier.durationDays}일</td>
                        <td className="p-3 text-right">{formatCurrency(tier.totalAmount)}</td>
                        <td className="p-3 text-right text-yellow-400">{formatCurrency(tier.dailyDeduction)}</td>
                    </tr>
                    ))}
                    {availableTiers.length === 0 && (
                    <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">추가할 수 있는 단가 항목이 없거나, 이미 모두 추가되었습니다.</td>
                    </tr>
                    )}
                </tbody>
                </table>
            </div>
          </div>
        </main>
        <footer className="p-6 mt-auto border-t border-slate-700 bg-slate-800/50 flex justify-end space-x-4">
          <button type="button" onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={selectedIds.size === 0}
            className="flex items-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlusIcon className="w-5 h-5 mr-2" />
            {selectedIds.size}개 항목 추가
          </button>
        </footer>
      </div>
    </div>
  );
};