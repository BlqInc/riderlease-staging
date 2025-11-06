import React, { useState } from 'react';
import { Partner, PriceTier } from '../types';
import { CloseIcon, EditIcon, TrashIcon, PlusIcon } from './icons/IconComponents';
import { formatCurrency } from '../lib/utils';
import { PriceListPickerModal } from './MasterPriceListPickerModal';
import { TemplatePickerModal } from './TemplatePickerModal';

interface PartnerDetailModalProps {
  partner: Partner | null;
  priceTemplates: Partner[];
  onClose: () => void;
  onEdit: (partner: Partner) => void;
  onDelete: (partnerId: string) => void;
  onAddPriceTier: (partnerId: string, priceTier: Omit<PriceTier, 'id'>) => void;
  onUpdatePriceTier: (partnerId: string, priceTierId: string, data: Omit<PriceTier, 'id'>) => void;
  onDeletePriceTier: (partnerId: string, priceTierId: string) => void;
  onAddPriceTiersFromMaster: (partnerId: string, tiers: PriceTier[]) => void;
}

const AddPriceTierForm: React.FC<{ partnerId: string; onAdd: PartnerDetailModalProps['onAddPriceTier']}> = ({ partnerId, onAdd }) => {
    const initialState = {
        model: '', storage: '', durationDays: 180, totalAmount: 0, dailyDeduction: 0
    };
    const [formState, setFormState] = React.useState(initialState);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        const isNumeric = ['durationDays', 'totalAmount', 'dailyDeduction'].includes(name);
        setFormState(prev => ({ ...prev, [name]: isNumeric ? Number(value) : value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formState.model || !formState.storage || !formState.totalAmount) {
            alert('기종, 용량, 총 채권액은 필수 항목입니다.');
            return;
        }
        onAdd(partnerId, formState);
        setFormState(initialState);
    };
    
    return (
        <form onSubmit={handleSubmit} className="bg-slate-900/50 p-4 rounded-lg mt-6">
            <h4 className="text-lg font-bold text-white mb-3">신규 단가 직접 추가</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <input type="text" name="model" value={formState.model} onChange={handleChange} placeholder="기종 (예: 아이폰 16)" className="bg-slate-700 col-span-2 md:col-span-1 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" required />
                <input type="text" name="storage" value={formState.storage} onChange={handleChange} placeholder="용량 (예: 256GB)" className="bg-slate-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" required />
                <select name="durationDays" value={formState.durationDays} onChange={handleChange} className="bg-slate-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value={180}>180일</option>
                    <option value={210}>210일</option>
                </select>
                <input type="number" name="totalAmount" value={formState.totalAmount} onChange={handleChange} placeholder="총 채권액" className="bg-slate-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" required />
                <input type="number" name="dailyDeduction" value={formState.dailyDeduction} onChange={handleChange} placeholder="일차감" className="bg-slate-700 text-white rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                 <button type="submit" className="flex items-center justify-center bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-3 rounded-lg transition-colors">
                    <PlusIcon className="w-5 h-5 mr-1" />
                    추가
                </button>
            </div>
        </form>
    );
};

export const PartnerDetailModal: React.FC<PartnerDetailModalProps> = ({ 
    partner, 
    priceTemplates, 
    onClose, 
    onEdit, 
    onDelete, 
    onAddPriceTier, 
    onUpdatePriceTier, 
    onDeletePriceTier, 
    onAddPriceTiersFromMaster 
}) => {
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [editedTierData, setEditedTierData] = useState<Omit<PriceTier, 'id'>>({ model: '', storage: '', durationDays: 0, totalAmount: 0, dailyDeduction: 0 });
  
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [isPricePickerOpen, setIsPricePickerOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Partner | null>(null);

  if (!partner) return null;
  
  const handleStartEdit = (tier: PriceTier) => {
    setEditingTierId(tier.id);
    setEditedTierData({
        model: tier.model,
        storage: tier.storage,
        durationDays: tier.durationDays,
        totalAmount: tier.totalAmount,
        dailyDeduction: tier.dailyDeduction,
    });
  };

  const handleCancelEdit = () => {
    setEditingTierId(null);
  };
  
  const handleSaveEdit = () => {
    if (editingTierId) {
        onUpdatePriceTier(partner.id, editingTierId, editedTierData);
        setEditingTierId(null);
    }
  };

  const handleTierChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditedTierData(prev => ({...prev, [name]: Number(value)}));
  };

  const handleDelete = () => {
      onDelete(partner.id);
  };
  
  const handleSelectTemplate = (template: Partner) => {
    setSelectedTemplate(template);
    setIsTemplatePickerOpen(false);
    setIsPricePickerOpen(true);
  };

  const handleClosePricePicker = () => {
    setIsPricePickerOpen(false);
    setSelectedTemplate(null);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
        <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
          <header className="flex justify-between items-center p-6 border-b border-slate-700">
            <div>
              <h2 className="text-2xl font-bold text-white">{partner.name}</h2>
              <p className="text-sm text-slate-400">{partner.businessNumber ? `사업자번호: ${partner.businessNumber}` : '사업자 정보 미등록'}</p>
            </div>
             <div className="flex items-center space-x-2">
              <button onClick={() => onEdit(partner)} className="p-2 rounded-full hover:bg-slate-700 transition-colors" aria-label="파트너 정보 수정">
                <EditIcon className="w-6 h-6 text-yellow-400" />
              </button>
              {!partner.isTemplate && (
                  <button onClick={handleDelete} className="p-2 rounded-full hover:bg-slate-700 transition-colors" aria-label="파트너 삭제">
                  <TrashIcon className="w-6 h-6 text-red-500" />
                  </button>
              )}
              <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors" aria-label="닫기">
                <CloseIcon className="w-6 h-6 text-slate-400" />
              </button>
            </div>
          </header>
          
          <main className="p-6 overflow-y-auto">
               <div className="bg-slate-900/50 p-4 rounded-lg mb-6">
                  <h3 className="font-bold text-white mb-2">사업자 정보</h3>
                  <p className="text-slate-300">주소: {partner.address || 'N/A'}</p>
               </div>
               
               <div className="flex justify-between items-center mb-4">
                 <h3 className="text-xl font-bold text-white">단가표 관리</h3>
                 {!partner.isTemplate && (
                    <button
                        onClick={() => setIsTemplatePickerOpen(true)}
                        className="flex items-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors whitespace-nowrap shadow-md"
                    >
                       <PlusIcon className="w-5 h-5 mr-2" />
                        템플릿에서 가져오기
                    </button>
                 )}
               </div>

              <div className="bg-slate-800 rounded-lg shadow-inner overflow-hidden">
                  <div className="overflow-x-auto max-h-[40vh]">
                      <table className="w-full text-left">
                          <thead className="bg-slate-700/50 sticky top-0">
                              <tr>
                                  <th className="p-3 font-semibold text-slate-400">기종</th>
                                  <th className="p-3 font-semibold text-slate-400">용량</th>
                                  <th className="p-3 font-semibold text-slate-400">기간</th>
                                  <th className="p-3 font-semibold text-slate-400 text-right">총 채권액</th>
                                  <th className="p-3 font-semibold text-slate-400 text-right">일차감</th>
                                  <th className="p-3 font-semibold text-slate-400 text-center">작업</th>
                              </tr>
                          </thead>
                          <tbody>
                          {(partner.priceList && partner.priceList.length > 0) ? partner.priceList.map(pt => (
                              <tr key={pt.id} className="border-b border-slate-700">
                                  {editingTierId === pt.id ? (
                                      <>
                                          <td className="p-3 font-medium text-white">{pt.model}</td>
                                          <td className="p-3">{pt.storage}</td>
                                          <td className="p-3">{pt.durationDays}일</td>
                                          <td className="p-2 text-right">
                                              <input type="number" name="totalAmount" value={editedTierData.totalAmount} onChange={handleTierChange} className="bg-slate-600 text-white w-28 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                                          </td>
                                          <td className="p-2 text-right">
                                              <input type="number" name="dailyDeduction" value={editedTierData.dailyDeduction} onChange={handleTierChange} className="bg-slate-600 text-white w-24 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                                          </td>
                                          <td className="p-3 text-center">
                                              <div className="flex justify-center space-x-2">
                                                  <button onClick={handleSaveEdit} className="text-green-400 hover:text-green-300 font-bold py-1 px-2 text-sm">저장</button>
                                                  <button onClick={handleCancelEdit} className="text-slate-400 hover:text-slate-300 font-bold py-1 px-2 text-sm">취소</button>
                                              </div>
                                          </td>
                                      </>
                                  ) : (
                                      <>
                                          <td className="p-3 font-medium text-white">{pt.model}</td>
                                          <td className="p-3">{pt.storage}</td>
                                          <td className="p-3">{pt.durationDays}일</td>
                                          <td className="p-3 text-right">{formatCurrency(pt.totalAmount)}</td>
                                          <td className="p-3 text-right text-yellow-400">{formatCurrency(pt.dailyDeduction)}</td>
                                          <td className="p-3 text-center">
                                              <div className="flex justify-center space-x-2">
                                                  <button onClick={() => handleStartEdit(pt)} className="p-1 text-yellow-500 hover:text-yellow-400" title="단가 수정">
                                                      <EditIcon className="w-5 h-5"/>
                                                  </button>
                                                  <button onClick={() => onDeletePriceTier(partner.id, pt.id)} className="p-1 text-red-500 hover:text-red-400" title="단가 삭제">
                                                      <TrashIcon className="w-5 h-5"/>
                                                  </button>
                                              </div>
                                          </td>
                                      </>
                                  )}
                              </tr>
                          )) : (
                              <tr>
                                  <td colSpan={6} className="p-8 text-center text-slate-400">등록된 단가표가 없습니다.</td>
                              </tr>
                          )}
                          </tbody>
                      </table>
                  </div>
              </div>

              <AddPriceTierForm partnerId={partner.id} onAdd={onAddPriceTier} />
          </main>
          
          <footer className="p-6 mt-auto border-t border-slate-700 bg-slate-800/50 flex justify-end">
              <button onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                  닫기
              </button>
          </footer>
        </div>
      </div>
      
      {isTemplatePickerOpen && (
        <TemplatePickerModal
          isOpen={isTemplatePickerOpen}
          onClose={() => setIsTemplatePickerOpen(false)}
          templates={priceTemplates}
          onSelect={handleSelectTemplate}
        />
      )}

      {isPricePickerOpen && selectedTemplate && (
        <PriceListPickerModal
          isOpen={isPricePickerOpen}
          onClose={handleClosePricePicker}
          priceList={selectedTemplate.priceList || []}
          existingPriceList={partner.priceList || []}
          onAddTiers={(tiers) => {
              onAddPriceTiersFromMaster(partner.id, tiers);
              handleClosePricePicker();
          }}
        />
      )}
    </>
  );
};