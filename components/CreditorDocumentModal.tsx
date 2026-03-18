import React, { useState, useRef, useCallback, useEffect } from 'react';
import XLSX from 'xlsx-js-style';
import { Contract } from '../types';
import { CloseIcon } from './icons/IconComponents';

interface Props {
  contract: Contract;
  onClose: () => void;
}

interface Rect { x: number; y: number; w: number; h: number; }
interface ImageMaskState {
  file: File;
  url: string;
  masks: Rect[];
}

const ssnToDisplayDate = (ssn: string | null): string => {
  if (!ssn || ssn.length < 6) return '';
  return `${ssn.substring(0, 2)}.${ssn.substring(2, 4)}.${ssn.substring(4, 6)}`;
};

const ssnToExcelDate = (ssn: string | null): string => {
  if (!ssn || ssn.length < 6) return '';
  return ssn.substring(0, 6);
};

const formatProductName = (contract: Contract): string => {
  const deviceNoSpace = (contract.device_name || '').replace(/\s+/g, '');
  const distName = contract.distributor_name || '';
  const units = contract.units_required || 1;
  return `${deviceNoSpace}(${distName})${units > 1 ? '_' + units + '대' : ''}`;
};

export const CreditorDocumentModal: React.FC<Props> = ({ contract, onClose }) => {
  const [activeTab, setActiveTab] = useState<'mask' | 'excel'>('mask');

  const [images, setImages] = useState<ImageMaskState[]>([]);
  const [currentImageIdx, setCurrentImageIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const currentImage = images[currentImageIdx];

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !currentImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    currentImage.masks.forEach(m => ctx.fillRect(m.x, m.y, m.w, m.h));
    if (currentRect) ctx.fillRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
  }, [currentImage, currentRect]);

  useEffect(() => {
    if (!currentImage) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxW = 760;
      const scale = Math.min(1, maxW / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      redraw();
    };
    img.src = currentImage.url;
  }, [currentImageIdx, currentImage?.url]); // eslint-disable-line

  useEffect(() => { redraw(); }, [redraw]);

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setStartPos(getCanvasPos(e));
    setDrawing(true);
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const pos = getCanvasPos(e);
    setCurrentRect({ x: Math.min(startPos.x, pos.x), y: Math.min(startPos.y, pos.y), w: Math.abs(pos.x - startPos.x), h: Math.abs(pos.y - startPos.y) });
  };
  const handleMouseUp = () => {
    if (!drawing) return;
    setDrawing(false);
    if (currentRect && currentRect.w > 5 && currentRect.h > 5) {
      const rect = currentRect;
      setImages(prev => prev.map((img, i) => i === currentImageIdx ? { ...img, masks: [...img.masks, rect] } : img));
    }
    setCurrentRect(null);
  };

  const undoLastMask = () => setImages(prev => prev.map((img, i) => i === currentImageIdx ? { ...img, masks: img.masks.slice(0, -1) } : img));
  const clearAllMasks = () => setImages(prev => prev.map((img, i) => i === currentImageIdx ? { ...img, masks: [] } : img));

  const downloadMasked = () => {
    const canvas = canvasRef.current;
    if (!canvas || !currentImage) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `마스킹_${currentImage.file.name.replace(/\.[^.]+$/, '')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImages(prev => {
      const next = [...prev, ...files.map(file => ({ file, url: URL.createObjectURL(file), masks: [] }))];
      if (prev.length === 0) setCurrentImageIdx(0);
      return next;
    });
    e.target.value = '';
  };

  const generateExcel = () => {
    const wb = XLSX.utils.book_new();
    const contractDate = contract.contract_date || '';
    const unitA = contract.unit_price_a || 0;
    const unitB = contract.unit_price_b || 0;
    const units = contract.units_required || 1;
    const durationDays = contract.duration_days || 180;
    const dailyTotal = (unitA + unitB) * units;
    const totalSales = dailyTotal * durationDays;
    const supplyAmount = (contract.unit_supply_price || 0) * units;
    const productName = formatProductName(contract);
    const homeAddress = contract.lessee_home_address || contract.lessee_business_address || '';

    // Sheet 1: 고객리스트
    const notes = '* 모든 주소 기재시 전자계약서상 원활한 기재를 위해 엑셀함수 [=len(해당셀)] 기준 43 이하로 기재 요청 * 아래 예시와 동일한 양식으로 기재 요청 ("-" 표기 필수) * 모든 총판 띄어쓰기 금지';
    const headers = ['접수일자','공급자 성명','공급자 생년월일','공급자 휴대전화','공급자 회사명','공급자 사업자번호','공급자 회사주소','구매자 성명','구매자 생년월일','구매자 휴대전화','성별(남,여)','구매자 집주소','연대보증인 성명','연대보증인 생년월일','연대보증인 휴대전화','연대보증인 집주소','상품명','수량(대수)','일출금액'];
    const row = [
      contractDate,
      contract.distributor_rep_name || contract.distributor_name || '',
      ssnToExcelDate(contract.distributor_ssn_prefix),
      contract.distributor_contact || '',
      contract.distributor_name || '',
      contract.distributor_business_number || '',
      contract.distributor_address || '',
      contract.lessee_name || '',
      ssnToExcelDate(contract.lessee_ssn_prefix),
      contract.lessee_contact || '',
      contract.lessee_gender || '',
      homeAddress,
      contract.guarantor_name || '',
      ssnToExcelDate(contract.guarantor_ssn_prefix),
      contract.guarantor_phone || '',
      contract.guarantor_address || '',
      productName,
      units,
      dailyTotal,
    ];
    const ws1 = XLSX.utils.aoa_to_sheet([[notes], [], headers, row]);
    ws1['!cols'] = headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws1, '고객리스트');

    // Sheet 2: 상품리스트
    const h2 = ['총판명','상품명','1대가격 일출금액(A)','영업수수료(B)','총대수','최종 일출금액(A+B)','계약기간(일수)','총매출액(=총렌탈료)','공급대금(1대공급가×총대수)'];
    const r2 = [
      contract.distributor_name || '',
      productName,
      unitA,
      unitB || '-',
      units,
      dailyTotal,
      durationDays,
      totalSales,
      supplyAmount || '-',
    ];
    const ws2 = XLSX.utils.aoa_to_sheet([h2, r2]);
    ws2['!cols'] = h2.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws2, '상품리스트');

    const dateStr = contractDate.replace(/-/g, '').substring(2);
    XLSX.writeFile(wb, `상품구매및이용계약서${dateStr}_${contract.distributor_name || '총판'}_${units}대.xlsx`);
  };

  const missingFields: string[] = [];
  if (!contract.distributor_rep_name) missingFields.push('공급자 성명(대표자)');
  if (!contract.distributor_ssn_prefix) missingFields.push('공급자 생년월일');
  if (!contract.lessee_ssn_prefix) missingFields.push('라이더 생년월일');
  if (!contract.lessee_gender) missingFields.push('라이더 성별');
  if (!contract.guarantor_name) missingFields.push('연대보증인 이름');
  if (!contract.guarantor_ssn_prefix) missingFields.push('연대보증인 생년월일');
  if (!contract.guarantor_phone) missingFields.push('연대보증인 전화');
  if (!contract.unit_price_a) missingFields.push('1대가격(A)');

  const tabClass = (tab: 'mask' | 'excel') =>
    `px-6 py-3 font-bold text-sm transition-colors ${activeTab === tab ? 'text-white border-b-2 border-indigo-400' : 'text-slate-400 hover:text-white'}`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[60] p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <div>
            <h2 className="text-xl font-bold text-white">채권사 서류 생성</h2>
            <p className="text-slate-400 text-sm">[#{contract.contract_number}] {contract.device_name} · {contract.lessee_name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        <div className="flex border-b border-slate-700">
          <button className={tabClass('mask')} onClick={() => setActiveTab('mask')}>📷 이미지 마스킹</button>
          <button className={tabClass('excel')} onClick={() => setActiveTab('excel')}>📊 엑셀 생성</button>
        </div>
        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === 'mask' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm">
                  📎 사진 업로드
                  <input type="file" accept="image/*" multiple onChange={handleFileUpload} className="hidden" />
                </label>
                <p className="text-slate-400 text-sm">신분증, 주민등록표, 사업자등록증 여러 장 한번에 업로드 가능</p>
              </div>
              {images.length > 0 ? (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {images.map((img, i) => (
                      <button key={i} onClick={() => setCurrentImageIdx(i)}
                        className={`px-3 py-1 rounded text-sm font-medium transition-colors ${i === currentImageIdx ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                        {img.file.name.length > 20 ? img.file.name.substring(0, 20) + '…' : img.file.name}
                        {img.masks.length > 0 && <span className="ml-1 text-yellow-400">({img.masks.length})</span>}
                      </button>
                    ))}
                  </div>
                  <div className="bg-slate-900 rounded-lg p-3">
                    <p className="text-slate-400 text-xs mb-2">클릭+드래그로 마스킹할 영역 선택 → 검정 블록으로 가려집니다</p>
                    <div className="overflow-auto max-h-[55vh] flex justify-center">
                      <canvas ref={canvasRef}
                        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
                        onMouseLeave={() => { if (drawing) { setDrawing(false); setCurrentRect(null); } }}
                        className="cursor-crosshair" style={{ maxWidth: '100%', display: 'block' }} />
                    </div>
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <button onClick={undoLastMask} className="bg-slate-700 hover:bg-slate-600 text-white py-2 px-4 rounded-lg text-sm transition-colors">↩ 마지막 취소</button>
                    <button onClick={clearAllMasks} className="bg-slate-700 hover:bg-slate-600 text-white py-2 px-4 rounded-lg text-sm transition-colors">전체 지우기</button>
                    <button onClick={downloadMasked} className="ml-auto bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-5 rounded-lg text-sm transition-colors">⬇ 마스킹 이미지 다운로드</button>
                  </div>
                </>
              ) : (
                <div className="text-center py-20 text-slate-500">
                  <p className="text-5xl mb-4">📷</p>
                  <p>사진을 업로드하면 여기에 표시됩니다</p>
                  <p className="text-sm mt-1">주민번호 뒷자리 등 민감정보를 드래그로 가려주세요</p>
                </div>
              )}
            </div>
          )}
          {activeTab === 'excel' && (
            <div className="space-y-6">
              {missingFields.length > 0 && (
                <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 p-4 rounded-lg text-sm">
                  <p className="font-bold mb-1">⚠ 미입력 항목 — 계약 수정에서 입력 후 다시 시도하세요:</p>
                  <p>{missingFields.join(', ')}</p>
                </div>
              )}
              <div className="bg-slate-900/50 p-5 rounded-lg space-y-4">
                <h3 className="font-bold text-white text-sm border-b border-slate-700 pb-2">입력 데이터 확인</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs mb-1">공급자(총판 대표)</p>
                    <p className="text-white font-medium">{contract.distributor_rep_name || '—'}</p>
                    <p className="text-slate-300 text-xs">{ssnToDisplayDate(contract.distributor_ssn_prefix) || '생년월일?'}</p>
                    <p className="text-slate-300 text-xs">{contract.distributor_name || '—'} ({contract.distributor_contact || '—'})</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs mb-1">구매자(라이더)</p>
                    <p className="text-white font-medium">{contract.lessee_name || '—'}</p>
                    <p className="text-slate-300 text-xs">{contract.lessee_gender || '성별?'} / {ssnToDisplayDate(contract.lessee_ssn_prefix) || '생년월일?'}</p>
                    <p className="text-slate-300 text-xs">{contract.lessee_contact || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs mb-1">연대보증인</p>
                    <p className="text-white font-medium">{contract.guarantor_name || '—'}</p>
                    <p className="text-slate-300 text-xs">{contract.guarantor_gender || ''} / {ssnToDisplayDate(contract.guarantor_ssn_prefix) || '생년월일?'}</p>
                    <p className="text-slate-300 text-xs">{contract.guarantor_phone || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs mb-1">상품·가격</p>
                    <p className="text-white font-medium text-xs">{formatProductName(contract)}</p>
                    <p className="text-slate-300 text-xs">A: {contract.unit_price_a?.toLocaleString() || '?'}원 / B: {contract.unit_price_b?.toLocaleString() || '0'}원</p>
                    <p className="text-slate-300 text-xs">공급가: {contract.unit_supply_price?.toLocaleString() || '미입력'}원</p>
                  </div>
                </div>
              </div>
              <button onClick={generateExcel} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-colors text-base">
                📊 엑셀 파일 생성 및 다운로드
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
