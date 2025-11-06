
import React, { useState, useEffect, useRef } from 'react';
import { Partner, PriceTier } from '../types';
import { CloseIcon, UploadIcon } from './icons/IconComponents';
import { read, utils } from 'xlsx';

interface PartnerFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (partner: Omit<Partner, 'id'> & { id?: string; priceList?: PriceTier[] }) => void;
  partnerToEdit: Partner | null;
  isTemplate?: boolean;
}

export const PartnerFormModal: React.FC<PartnerFormModalProps> = ({ isOpen, onClose, onSave, partnerToEdit, isTemplate: isNewTemplate }) => {
  const [name, setName] = useState('');
  const [business_number, setBusiness_number] = useState('');
  const [address, setAddress] = useState('');
  const [isTemplate, setIsTemplate] = useState(false);
  const [priceList, setPriceList] = useState<PriceTier[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
        if (partnerToEdit) {
            setName(partnerToEdit.name);
            setBusiness_number(partnerToEdit.business_number || '');
            setAddress(partnerToEdit.address || '');
            setIsTemplate(!!partnerToEdit.is_template);
            setPriceList(partnerToEdit.priceList || []);
        } else {
            setName('');
            setBusiness_number('');
            setAddress('');
            setIsTemplate(!!isNewTemplate);
            setPriceList([]);
        }
        setImportMessage('');
        setIsLoading(false);
    }
  }, [partnerToEdit, isOpen, isNewTemplate]);

  if (!isOpen) return null;
  
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setImportMessage('');
    try {
        const data = await file.arrayBuffer();
        const workbook = read(data);
        const worksheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[worksheetName];
        // 첫 번째 행은 헤더로 간주하고 건너뜁니다 (range: 1).
        const json: any[] = utils.sheet_to_json(worksheet, {
            header: ["model", "storage", "durationDays", "totalAmount", "dailyDeduction"],
            range: 1 
        });

        const newPriceTiers: PriceTier[] = json.map((row: any) => ({
            id: `pt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            model: String(row.model || '').trim(),
            storage: String(row.storage || '').trim(),
            durationDays: Number(row.durationDays || 0),
            totalAmount: Number(row.totalAmount || 0),
            dailyDeduction: Number(row.dailyDeduction || 0),
        })).filter(tier => tier.model && tier.totalAmount > 0); // 기본 유효성 검사

        setPriceList(newPriceTiers);
        setImportMessage(`✅ ${newPriceTiers.length}개의 단가 항목을 성공적으로 불러왔습니다.`);
    } catch (error) {
        console.error("Error parsing Excel file:", error);
        setImportMessage('❌ 파일 처리 중 오류가 발생했습니다. 파일 형식(열 순서: 기종, 용량, 기간, 총채권액, 일차감)을 확인해주세요.');
        setPriceList([]);
    } finally {
        setIsLoading(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
        alert('파트너사/템플릿 이름을 입력해주세요.');
        return;
    }
    const saveData: Omit<Partner, 'id'> & { id?: string; priceList?: PriceTier[] } = {
      name,
      business_number,
      address,
      is_template: isTemplate,
      priceList: priceList,
    };
    if (partnerToEdit?.id) {
        saveData.id = partnerToEdit.id;
    }
    onSave(saveData);
  };
  
  const title = partnerToEdit ? '정보 수정' : (isNewTemplate ? '신규 템플릿 추가' : '신규 파트너사 추가');
  const isNewTemplateCreation = !partnerToEdit && isNewTemplate;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        
        <form onSubmit={handleSubmit}>
            <div className="p-6 space-y-4">
                <div>
                    <label htmlFor="partnerName" className="block text-sm font-medium text-slate-400 mb-2">이름</label>
                    <input 
                        id="partnerName"
                        type="text" 
                        value={name} 
                        onChange={(e) => setName(e.target.value)} 
                        placeholder={isTemplate ? "예: 아이폰 전문 단가표" : "예: BLQ 솔루션"} 
                        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                        required 
                        autoFocus
                    />
                </div>

                {isNewTemplateCreation && (
                    <div className="bg-slate-900/50 p-4 rounded-lg space-y-3">
                        <label className="block text-sm font-medium text-slate-400">단가표 가져오기</label>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileImport}
                            className="hidden"
                            accept=".xlsx, .xls"
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isLoading}
                            className="w-full flex items-center justify-center bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <UploadIcon className="w-5 h-5 mr-2" />
                            {isLoading ? '처리 중...' : '엑셀로 가져오기'}
                        </button>
                         {importMessage && (
                            <p className={`text-sm text-center ${importMessage.startsWith('❌') ? 'text-red-400' : 'text-green-400'}`}>
                                {importMessage}
                            </p>
                        )}
                        <p className="text-xs text-slate-500 text-center">
                           A열부터 기종, 용량, 기간, 총채권액, 일차감 순서여야 합니다.
                        </p>
                    </div>
                )}

                 {!isTemplate && (
                     <>
                        <div>
                            <label htmlFor="business_number" className="block text-sm font-medium text-slate-400 mb-2">사업자 번호</label>
                            <input 
                                id="business_number"
                                type="text" 
                                value={business_number} 
                                onChange={(e) => setBusiness_number(e.target.value)} 
                                placeholder="예: 123-45-67890" 
                                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                            />
                        </div>
                        <div>
                            <label htmlFor="address" className="block text-sm font-medium text-slate-400 mb-2">사업자 주소</label>
                            <input 
                                id="address"
                                type="text" 
                                value={address} 
                                onChange={(e) => setAddress(e.target.value)} 
                                placeholder="예: 서울시 강남구 테헤란로 123" 
                                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                            />
                        </div>
                     </>
                 )}

                 <div className="flex items-center pt-2">
                    <input
                        type="checkbox"
                        id="isTemplate"
                        name="isTemplate"
                        checked={isTemplate}
                        onChange={(e) => setIsTemplate(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="isTemplate" className="ml-2 block text-sm text-slate-300">
                        단가표 템플릿으로 저장
                    </label>
                </div>
            </div>
            
            <footer className="p-6 bg-slate-800/50 flex justify-end space-x-4">
                <button type="button" onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                    취소
                </button>
                <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                    저장
                </button>
            </footer>
        </form>
      </div>
    </div>
  );
};