
import React from 'react';
import { Partner } from '../types';
import { PlusIcon, UserPlusIcon } from './icons/IconComponents';

interface PartnersManagementProps {
  partners: Partner[];
  onSelectPartner: (partnerId: string) => void;
  onAddPartner: () => void;
  onAddTemplate: () => void;
}

const PartnerCard: React.FC<{ partner: Partner; onSelect: () => void; }> = ({ partner, onSelect }) => (
    <div 
        onClick={onSelect}
        className="bg-slate-800 p-5 rounded-lg shadow-lg cursor-pointer transition-transform transform hover:-translate-y-1 hover:shadow-indigo-500/20 border border-slate-700 hover:border-indigo-600"
    >
        <h3 className="text-lg font-bold text-white truncate">{partner.name}</h3>
        {partner.isTemplate ? (
            <p className="text-xs text-indigo-400 font-semibold mt-1">단가표 템플릿</p>
        ) : (
            <p className="text-sm text-slate-400 mt-1 truncate">{partner.businessNumber || '사업자 정보 미등록'}</p>
        )}
        <p className="text-xs text-slate-500 mt-3">{partner.priceList?.length || 0}개 단가 항목</p>
    </div>
);

export const PartnersManagement: React.FC<PartnersManagementProps> = ({ partners, onSelectPartner, onAddPartner, onAddTemplate }) => {
  const regularPartners = partners.filter(p => !p.isTemplate);
  const templatePartners = partners.filter(p => p.isTemplate);

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-white">파트너사 관리</h2>
        <div className="flex space-x-3">
             <button 
                onClick={onAddTemplate}
                className="flex items-center bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-md"
            >
                <PlusIcon className="w-5 h-5 mr-2"/>
                신규 단가표 템플릿
            </button>
            <button 
                onClick={onAddPartner}
                className="flex items-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-md"
            >
                <UserPlusIcon className="w-5 h-5 mr-2"/>
                신규 파트너사
            </button>
        </div>
      </div>

      <section>
          <h3 className="text-2xl font-semibold text-white mb-4 border-b border-slate-700 pb-2">파트너사 목록</h3>
          {regularPartners.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {regularPartners.map(partner => (
                      <PartnerCard key={partner.id} partner={partner} onSelect={() => onSelectPartner(partner.id)} />
                  ))}
              </div>
          ) : (
            <div className="text-center py-12 bg-slate-800 rounded-lg">
                <p className="text-slate-400">등록된 파트너사가 없습니다.</p>
                <p className="text-sm text-slate-500 mt-2">'신규 파트너사' 버튼을 눌러 추가해주세요.</p>
            </div>
          )}
      </section>

      <section className="mt-12">
          <h3 className="text-2xl font-semibold text-white mb-4 border-b border-slate-700 pb-2">단가표 템플릿</h3>
           {templatePartners.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {templatePartners.map(partner => (
                      <PartnerCard key={partner.id} partner={partner} onSelect={() => onSelectPartner(partner.id)} />
                  ))}
              </div>
          ) : (
            <div className="text-center py-12 bg-slate-800 rounded-lg">
                <p className="text-slate-400">등록된 템플릿이 없습니다.</p>
                 <p className="text-sm text-slate-500 mt-2">'신규 단가표 템플릿' 버튼을 눌러 추가해주세요.</p>
            </div>
          )}
      </section>
    </div>
  );
};
