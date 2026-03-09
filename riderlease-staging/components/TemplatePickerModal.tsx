
import React, { useState, useMemo } from 'react';
import { Partner } from '../types';
import { CloseIcon } from './icons/IconComponents';

interface TemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: Partner[];
  onSelect: (template: Partner) => void;
}

export const TemplatePickerModal: React.FC<TemplatePickerModalProps> = ({
  isOpen,
  onClose,
  templates,
  onSelect,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTemplates = useMemo(() => {
    return templates.filter(t => 
      t.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [templates, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[70] p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">단가표 템플릿 선택</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>

        <div className="p-6">
          <input
            type="text"
            placeholder="템플릿 이름으로 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-700 text-white placeholder-slate-400 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
        </div>

        <main className="px-6 pb-6 overflow-y-auto flex-grow">
          <div className="space-y-3">
            {filteredTemplates.map(template => (
              <div
                key={template.id}
                onClick={() => onSelect(template)}
                className="bg-slate-700 p-4 rounded-lg cursor-pointer transition-colors hover:bg-indigo-600/50 border border-transparent hover:border-indigo-500"
              >
                <h3 className="font-bold text-white text-lg">{template.name}</h3>
                <p className="text-sm text-slate-400">
                  {template.price_list?.length || 0}개의 단가 항목 포함
                </p>
              </div>
            ))}
            {filteredTemplates.length === 0 && (
              <p className="text-center text-slate-400 py-8">
                일치하는 템플릿이 없습니다.
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
