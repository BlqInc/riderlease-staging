import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Contract } from '../types';
import { CloseIcon } from './icons/IconComponents';

interface Props {
  contracts: Contract[];
}

interface Rect { x: number; y: number; w: number; h: number; }

interface MaskingSession {
  contractId: string;
  docType: string;
  file: File;
  url: string;
  masks: Rect[];
}

// Helper functions
const ssnToExcelDate = (ssn: string | null): string => {
  if (!ssn || ssn.length < 6) return '';
  return ssn.substring(0, 6);
};

const formatProductName = (c: Contract): string => {
  const deviceNoSpace = (c.device_name || '').replace(/\s+/g, '');
  const dist = c.distributor_name || '';
  const units = c.units_required || 1;
  return `${deviceNoSpace}(${dist})${units > 1 ? '_' + units + '대' : ''}`;
};

// Masking modal component (inline)
const MaskingModal: React.FC<{
  session: MaskingSession;
  onSave: (masks: Rect[]) => void;
  onClose: () => void;
}> = ({ session, onSave, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [masks, setMasks] = useState<Rect[]>(session.masks);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    masks.forEach(m => ctx.fillRect(m.x, m.y, m.w, m.h));
    if (currentRect) ctx.fillRect(currentRect.x, currentRect.y, currentRect.w, currentRect.h);
  }, [masks, currentRect]);

  useEffect(() => {
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
    img.src = session.url;
  }, []); // eslint-disable-line

  useEffect(() => { redraw(); }, [redraw]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `마스킹_${session.docType}_${session.file.name.replace(/\.[^.]+$/, '')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[70] p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="flex justify-between items-center p-4 border-b border-slate-700">
          <h3 className="font-bold text-white">{session.docType} 마스킹 · {session.file.name}</h3>
          <div className="flex gap-2">
            <button onClick={() => setMasks(prev => prev.slice(0, -1))} className="bg-slate-700 hover:bg-slate-600 text-white py-1 px-3 rounded text-sm">↩ 취소</button>
            <button onClick={() => setMasks([])} className="bg-slate-700 hover:bg-slate-600 text-white py-1 px-3 rounded text-sm">전체 지우기</button>
            <button onClick={download} className="bg-green-600 hover:bg-green-700 text-white font-bold py-1 px-3 rounded text-sm">⬇ 다운로드</button>
            <button onClick={() => { onSave(masks); onClose(); }} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 px-3 rounded text-sm">완료</button>
            <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded"><CloseIcon className="w-5 h-5 text-slate-400" /></button>
          </div>
        </header>
        <div className="p-3 text-slate-400 text-xs">클릭+드래그로 마스킹 영역 선택 (주민번호 뒷자리 등)</div>
        <div className="flex-1 overflow-auto flex justify-center p-2">
          <canvas ref={canvasRef}
            onMouseDown={e => { setStartPos(getPos(e)); setDrawing(true); }}
            onMouseMove={e => { if (!drawing) return; const pos = getPos(e); setCurrentRect({ x: Math.min(startPos.x, pos.x), y: Math.min(startPos.y, pos.y), w: Math.abs(pos.x - startPos.x), h: Math.abs(pos.y - startPos.y) }); }}
            onMouseUp={() => { if (!drawing) return; setDrawing(false); if (currentRect && currentRect.w > 5 && currentRect.h > 5) { setMasks(prev => [...prev, currentRect]); } setCurrentRect(null); }}
            onMouseLeave={() => { if (drawing) { setDrawing(false); setCurrentRect(null); } }}
            className="cursor-crosshair" style={{ maxWidth: '100%', display: 'block' }}
          />
        </div>
      </div>
    </div>
  );
};

const DOC_TYPES = ['신분증', '주민등록표', '사업자등록증'] as const;
type DocType = typeof DOC_TYPES[number];

interface ContractDocs {
  [docType: string]: { file: File; url: string; masks: Rect[] } | null;
}

export const CreditorBatch: React.FC<Props> = ({ contracts }) => {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contractDocs, setContractDocs] = useState<Record<string, ContractDocs>>({});
  const [maskingSession, setMaskingSession] = useState<MaskingSession | null>(null);
  const [activeTab, setActiveTab] = useState<'excel' | 'mask'>('excel');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return contracts;
    return contracts.filter(c =>
      (c.lessee_name || '').toLowerCase().includes(q) ||
      (c.distributor_name || '').toLowerCase().includes(q) ||
      (c.device_name || '').toLowerCase().includes(q) ||
      String(c.contract_number).includes(q)
    );
  }, [contracts, search]);

  const selectedContracts = useMemo(() =>
    contracts.filter(c => selectedIds.has(c.id)),
    [contracts, selectedIds]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
  };

  const generateBatchExcel = () => {
    if (selectedContracts.length === 0) return;
    const wb = XLSX.utils.book_new();

    // Sheet 1: 고객리스트
    const notes = '* 모든 주소 기재시 전자계약서상 원활한 기재를 위해 엑셀함수 [=len(해당셀)] 기준 43 이하로 기재 요청';
    const headers = ['접수일자','공급자 성명','공급자 생년월일','공급자 휴대전화','공급자 회사명','공급자 사업자번호','공급자 회사주소','구매자 성명','구매자 생년월일','구매자 휴대전화','성별(남,여)','구매자 집주소','연대보증인 성명','연대보증인 생년월일','연대보증인 휴대전화','연대보증인 집주소','상품명','수량(대수)','일출금액'];

    const dataRows = selectedContracts.map(c => {
      const homeAddress = c.lessee_home_address || c.lessee_business_address || '';
      const dailyTotal = ((c.unit_price_a || 0) + (c.unit_price_b || 0)) * (c.units_required || 1);
      return [
        c.contract_date || '',
        c.distributor_rep_name || c.distributor_name || '',
        ssnToExcelDate(c.distributor_ssn_prefix),
        c.distributor_contact || '',
        c.distributor_name || '',
        c.distributor_business_number || '',
        c.distributor_address || '',
        c.lessee_name || '',
        ssnToExcelDate(c.lessee_ssn_prefix),
        c.lessee_contact || '',
        c.lessee_gender || '',
        homeAddress,
        c.guarantor_name || '',
        ssnToExcelDate(c.guarantor_ssn_prefix),
        c.guarantor_phone || '',
        c.guarantor_address || '',
        formatProductName(c),
        c.units_required || 1,
        dailyTotal,
      ];
    });

    const ws1 = XLSX.utils.aoa_to_sheet([[notes], [], headers, ...dataRows]);
    ws1['!cols'] = headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws1, '고객리스트');

    // Sheet 2: 상품리스트
    const h2 = ['총판명','상품명','1대가격 일출금액(A)','영업수수료(B)','총대수','최종 일출금액(A+B)','계약기간(일수)','총매출액','공급대금'];
    const prodRows = selectedContracts.map(c => {
      const unitA = c.unit_price_a || 0;
      const unitB = c.unit_price_b || 0;
      const units = c.units_required || 1;
      const days = c.duration_days || 180;
      const dailyTotal = (unitA + unitB) * units;
      return [
        c.distributor_name || '',
        formatProductName(c),
        unitA,
        unitB || '-',
        units,
        dailyTotal,
        days,
        dailyTotal * days,
        c.unit_supply_price ? c.unit_supply_price * units : '-',
      ];
    });
    const ws2 = XLSX.utils.aoa_to_sheet([h2, ...prodRows]);
    ws2['!cols'] = h2.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws2, '상품리스트');

    const today = new Date();
    const dateStr = `${String(today.getFullYear()).substring(2)}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`;
    const distNames = [...new Set(selectedContracts.map(c => c.distributor_name || '').filter(Boolean))].slice(0, 3).join(',');
    const totalUnits = selectedContracts.reduce((sum, c) => sum + (c.units_required || 1), 0);
    XLSX.writeFile(wb, `상품구매및이용계약서${dateStr}_${distNames}_총${totalUnits}대.xlsx`);
  };

  const handleDocUpload = (contractId: string, docType: string, file: File) => {
    const url = URL.createObjectURL(file);
    setContractDocs(prev => ({
      ...prev,
      [contractId]: { ...(prev[contractId] || {}), [docType]: { file, url, masks: [] } },
    }));
  };

  const openMasking = (contractId: string, docType: string) => {
    const doc = contractDocs[contractId]?.[docType];
    if (!doc) return;
    setMaskingSession({ contractId, docType, file: doc.file, url: doc.url, masks: doc.masks });
  };

  const saveMasks = (masks: Rect[]) => {
    if (!maskingSession) return;
    const { contractId, docType } = maskingSession;
    setContractDocs(prev => ({
      ...prev,
      [contractId]: { ...(prev[contractId] || {}), [docType]: { ...(prev[contractId]?.[docType]!), masks } },
    }));
  };

  const downloadMasked = (contractId: string, docType: string) => {
    const doc = contractDocs[contractId]?.[docType];
    if (!doc) return;
    const canvas = document.createElement('canvas');
    const img = new Image();
    img.onload = () => {
      const maxW = 1200;
      const scale = Math.min(1, maxW / img.naturalWidth);
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'black';
      doc.masks.forEach(m => ctx.fillRect(m.x, m.y, m.w, m.h));
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const contract = contracts.find(c => c.id === contractId);
        a.download = `마스킹_${contract?.lessee_name || ''}_${docType}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = doc.url;
  };

  const tabClass = (tab: 'excel' | 'mask') =>
    `px-5 py-3 font-bold text-sm transition-colors ${activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">채권사 발송</h2>
          <p className="text-slate-400 text-sm mt-1">계약건을 선택하고 엑셀 생성 또는 이미지 마스킹을 진행하세요</p>
        </div>
        <div className="flex gap-2 bg-slate-800 rounded-lg p-1">
          <button className={tabClass('excel')} onClick={() => setActiveTab('excel')}>📊 엑셀 생성</button>
          <button className={tabClass('mask')} onClick={() => setActiveTab('mask')}>📷 이미지 마스킹</button>
        </div>
      </div>

      {/* Contract selection */}
      <div className="bg-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="계약번호, 라이더명, 총판명, 기종 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-slate-400 text-sm whitespace-nowrap">{selectedIds.size}건 선택</span>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-1">
          <div className="flex items-center gap-3 p-2 text-xs text-slate-500 border-b border-slate-700 sticky top-0 bg-slate-800">
            <input type="checkbox"
              checked={filtered.length > 0 && selectedIds.size === filtered.length}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600"
            />
            <span>전체 선택</span>
          </div>
          {filtered.map(c => (
            <label key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 cursor-pointer transition-colors">
              <input type="checkbox"
                checked={selectedIds.has(c.id)}
                onChange={() => toggleSelect(c.id)}
                className="h-4 w-4 rounded border-slate-500 bg-slate-700 text-indigo-600"
              />
              <span className="text-slate-400 text-xs w-12 shrink-0">#{c.contract_number}</span>
              <span className="text-white text-sm font-medium w-24 shrink-0 truncate">{c.lessee_name}</span>
              <span className="text-slate-300 text-xs w-32 shrink-0 truncate">{c.distributor_name}</span>
              <span className="text-slate-400 text-xs truncate">{c.device_name} · {c.units_required}대</span>
              <span className="ml-auto text-xs shrink-0">
                {!c.distributor_rep_name || !c.unit_price_a ? (
                  <span className="text-yellow-400">⚠ 정보 부족</span>
                ) : (
                  <span className="text-green-400">✓ 준비됨</span>
                )}
              </span>
            </label>
          ))}
          {filtered.length === 0 && <p className="text-center text-slate-500 py-4 text-sm">검색 결과 없음</p>}
        </div>
      </div>

      {/* Excel tab */}
      {activeTab === 'excel' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-slate-300 text-sm">선택된 {selectedContracts.length}건이 하나의 엑셀(고객리스트 + 상품리스트)로 생성됩니다</p>
            <button
              onClick={generateBatchExcel}
              disabled={selectedContracts.length === 0}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2 px-6 rounded-lg transition-colors"
            >
              📊 선택 {selectedContracts.length}건 엑셀 생성
            </button>
          </div>

          {selectedContracts.length > 0 && (
            <div className="bg-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700 text-slate-300">
                    <th className="p-3 text-left">계약#</th>
                    <th className="p-3 text-left">공급자 성명</th>
                    <th className="p-3 text-left">총판명</th>
                    <th className="p-3 text-left">구매자(라이더)</th>
                    <th className="p-3 text-left">상품</th>
                    <th className="p-3 text-left">가격 A</th>
                    <th className="p-3 text-left">연대보증인</th>
                    <th className="p-3 text-left">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedContracts.map(c => {
                    const missing = [];
                    if (!c.distributor_rep_name) missing.push('공급자명');
                    if (!c.distributor_ssn_prefix) missing.push('공급자생년');
                    if (!c.lessee_ssn_prefix) missing.push('라이더생년');
                    if (!c.lessee_gender) missing.push('라이더성별');
                    if (!c.guarantor_name) missing.push('보증인');
                    if (!c.unit_price_a) missing.push('1대가격');
                    return (
                      <tr key={c.id} className="border-t border-slate-700 hover:bg-slate-700/30">
                        <td className="p-3 text-slate-400">#{c.contract_number}</td>
                        <td className="p-3 text-white">{c.distributor_rep_name || <span className="text-yellow-400">미입력</span>}</td>
                        <td className="p-3 text-slate-300">{c.distributor_name}</td>
                        <td className="p-3 text-white">{c.lessee_name}</td>
                        <td className="p-3 text-slate-300 text-xs">{formatProductName(c)}</td>
                        <td className="p-3 text-slate-300">{c.unit_price_a?.toLocaleString() || <span className="text-yellow-400">미입력</span>}</td>
                        <td className="p-3 text-slate-300">{c.guarantor_name || <span className="text-yellow-400">미입력</span>}</td>
                        <td className="p-3">
                          {missing.length === 0
                            ? <span className="text-green-400 text-xs">✓ 완료</span>
                            : <span className="text-yellow-400 text-xs">⚠ {missing.join(', ')}</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Masking tab */}
      {activeTab === 'mask' && (
        <div className="space-y-4">
          {selectedContracts.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <p className="text-3xl mb-3">📋</p>
              <p>위에서 계약건을 선택하세요</p>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedContracts.map(c => (
                <div key={c.id} className="bg-slate-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-slate-400 text-xs">#{c.contract_number}</span>
                      <span className="text-white font-bold ml-2">{c.lessee_name}</span>
                      <span className="text-slate-400 text-sm ml-2">· {c.distributor_name} · {c.device_name}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {DOC_TYPES.map(docType => {
                      const doc = contractDocs[c.id]?.[docType];
                      return (
                        <div key={docType} className="bg-slate-700 rounded-lg p-3 space-y-2">
                          <p className="text-slate-300 text-xs font-medium">{docType}</p>
                          {doc ? (
                            <>
                              <p className="text-slate-400 text-xs truncate">{doc.file.name}</p>
                              {doc.masks.length > 0 && <p className="text-yellow-400 text-xs">{doc.masks.length}개 마스킹됨</p>}
                              <div className="flex gap-1">
                                <button onClick={() => openMasking(c.id, docType)}
                                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs py-1 rounded transition-colors">
                                  마스킹 편집
                                </button>
                                <button onClick={() => downloadMasked(c.id, docType)}
                                  className="bg-green-600 hover:bg-green-700 text-white text-xs py-1 px-2 rounded transition-colors">
                                  ⬇
                                </button>
                              </div>
                            </>
                          ) : (
                            <label className="block cursor-pointer">
                              <div className="border-2 border-dashed border-slate-600 hover:border-indigo-500 rounded-lg p-3 text-center transition-colors">
                                <p className="text-slate-500 text-xs">클릭하여 업로드</p>
                              </div>
                              <input type="file" accept="image/*"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleDocUpload(c.id, docType, f); e.target.value = ''; }}
                                className="hidden" />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Masking modal */}
      {maskingSession && (
        <MaskingModal
          session={maskingSession}
          onSave={saveMasks}
          onClose={() => setMaskingSession(null)}
        />
      )}
    </div>
  );
};
