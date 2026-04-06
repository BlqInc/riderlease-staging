import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Contract, Partner } from '../types';

interface Token {
  id: string;
  distributor_name: string;
  token: string;
  is_active: boolean;
  created_at?: string;
}

interface UploadedDoc {
  id: string;
  token_id: string;
  distributor_name: string;
  contract_id: string;
  doc_type: string;
  file_name: string;
  file_url: string;
  uploaded_at: string;
  supplier_name?: string;
  supplier_phone?: string;
  rider_name?: string;
  rider_phone?: string;
  guarantor_name?: string;
  guarantor_phone?: string;
  device_model?: string;
  device_capacity?: string;
  contract_period?: number;
  is_same_person?: boolean;
  devices_json?: string;
}

interface DeviceItem {
  model: string;
  capacity: string;
  quantity: number;
  period: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  business_registration: '사업자등록증',
  supplier_id: '대표자(공급자) 신분증',
  supplier_resident: '대표자(공급자) 등본',
  biz_cert_original: '사업자등록증명 원본',
  guarantor_id: '보증인 신분증',
  guarantor_resident: '보증인 등본',
  rider_id: '라이더(구매자) 신분증',
  rider_resident: '라이더(구매자) 등본',
};

const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
  </svg>
);

interface DocumentStatusProps {
  partners?: Partner[];
  onContractCreated?: () => void;
}

export const DocumentStatus: React.FC<DocumentStatusProps> = ({ partners = [], onContractCreated }) => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDistributorName, setNewDistributorName] = useState('');
  const [generatingToken, setGeneratingToken] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterDistributor, setFilterDistributor] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [creatingContract, setCreatingContract] = useState<string | null>(null);
  const [createdContracts, setCreatedContracts] = useState<Set<string>>(new Set());
  const [hiddenContracts, setHiddenContracts] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null); // contract_id being edited
  const [editForm, setEditForm] = useState<{
    supplier_name: string;
    supplier_phone: string;
    rider_name: string;
    rider_phone: string;
    guarantor_name: string;
    guarantor_phone: string;
    is_same_person: boolean;
    devices: DeviceItem[];
  }>({ supplier_name: '', supplier_phone: '', rider_name: '', rider_phone: '', guarantor_name: '', guarantor_phone: '', is_same_person: true, devices: [] });
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const [tokensRes, docsRes] = await Promise.all([
        (supabase.from('distributor_tokens') as any).select('*').order('created_at', { ascending: false }),
        (supabase.from('uploaded_documents') as any).select('*').order('uploaded_at', { ascending: false }),
      ]);
      if (tokensRes.data) setTokens(tokensRes.data);
      if (docsRes.data) setDocuments(docsRes.data);
    } catch (e) {
      console.error('Error fetching document status:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const generateToken = async () => {
    if (!supabase || !newDistributorName.trim()) return;
    setGeneratingToken(true);
    try {
      const token = crypto.randomUUID().replace(/-/g, '').substring(0, 24);
      const { data, error } = await (supabase.from('distributor_tokens') as any)
        .insert({
          distributor_name: newDistributorName.trim(),
          token,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setTokens(prev => [data, ...prev]);
        setNewDistributorName('');
      }
    } catch (error: any) {
      alert(`토큰 생성 실패: ${error.message}`);
    } finally {
      setGeneratingToken(false);
    }
  };

  const toggleToken = async (id: string, currentActive: boolean) => {
    if (!supabase) return;
    try {
      const { error } = await (supabase.from('distributor_tokens') as any)
        .update({ is_active: !currentActive })
        .eq('id', id);
      if (error) throw error;
      setTokens(prev => prev.map(t => t.id === id ? { ...t, is_active: !currentActive } : t));
    } catch (error: any) {
      alert(`상태 변경 실패: ${error.message}`);
    }
  };

  const copyToClipboard = (token: string, id: string) => {
    const baseUrl = window.location.origin + window.location.pathname;
    const url = `${baseUrl}?token=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // 계약 자동 생성
  const handleCreateContract = async (contractId: string, docs: UploadedDoc[]) => {
    if (!supabase) return;
    const firstDoc = docs[0];

    // 파트너 찾기 (총판명 기준)
    let partnerId = '';
    const matchedPartner = partners.find(p =>
      p.name === firstDoc.distributor_name || p.name.includes(firstDoc.distributor_name)
    );

    if (matchedPartner) {
      partnerId = matchedPartner.id;
    } else {
      // 파트너가 없으면 첫 번째 파트너 사용 (또는 빈값)
      partnerId = partners[0]?.id || '';
    }

    // 단가표에서 가격 매칭
    let totalAmount = 0;
    let dailyDeduction = 0;
    let durationDays = firstDoc.contract_period || 180;
    const deviceName = `${firstDoc.device_model || ''} ${firstDoc.device_capacity || ''}`.trim();

    if (matchedPartner?.price_list) {
      const tier = matchedPartner.price_list.find(t =>
        t.model === firstDoc.device_model &&
        t.storage === firstDoc.device_capacity &&
        t.duration_days === durationDays
      );
      if (tier) {
        totalAmount = tier.total_amount;
        dailyDeduction = tier.daily_deduction;
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const expiryDate = new Date(Date.now() + durationDays * 86400000).toISOString().split('T')[0];

    // 계약자명 결정: 라이더가 있으면 라이더, 없으면 공급자
    const lesseeName = firstDoc.rider_name || firstDoc.supplier_name || '';
    const lesseeContact = firstDoc.rider_phone || firstDoc.supplier_phone || '';

    setCreatingContract(contractId);
    try {
      const insertData: any = {
        device_name: deviceName,
        color: '',
        contract_date: today,
        expiry_date: expiryDate,
        duration_days: durationDays,
        total_amount: totalAmount,
        daily_deduction: dailyDeduction,
        status: '진행중',
        lessee_name: lesseeName,
        lessee_contact: lesseeContact,
        distributor_name: firstDoc.distributor_name || firstDoc.supplier_name || '',
        distributor_contact: firstDoc.supplier_phone || '',
        units_required: 1,
        settlement_status: '준비중',
        is_lessee_contract_signed: false,
        unpaid_balance: 0,
      };
      // partner_id가 유효한 UUID일 때만 포함
      if (partnerId && partnerId.length > 10) insertData.partner_id = partnerId;

      const { error } = await (supabase.from('contracts') as any).insert(insertData);

      if (error) throw error;

      setCreatedContracts(prev => new Set(prev).add(contractId));
      if (onContractCreated) onContractCreated();
      alert('계약이 등록되었습니다. 계약 관리 탭에서 상세 정보를 확인/수정해주세요.');
    } catch (error: any) {
      alert(`계약 등록 실패: ${error.message}`);
    } finally {
      setCreatingContract(null);
    }
  };

  // 전체 정보 편집
  const startEditing = (contractId: string, docs: UploadedDoc[]) => {
    const f = docs[0];
    let deviceList: DeviceItem[] = [];
    if (f.devices_json) { try { deviceList = JSON.parse(f.devices_json); } catch {} }
    if (deviceList.length === 0) {
      deviceList = [{ model: f.device_model || '', capacity: f.device_capacity || '', quantity: 1, period: String(f.contract_period || 180) }];
    }
    setEditForm({
      supplier_name: f.supplier_name || '',
      supplier_phone: f.supplier_phone || '',
      rider_name: f.rider_name || '',
      rider_phone: f.rider_phone || '',
      guarantor_name: f.guarantor_name || '',
      guarantor_phone: f.guarantor_phone || '',
      is_same_person: f.is_same_person ?? true,
      devices: deviceList,
    });
    setEditingId(contractId);
  };

  const saveEditing = async (contractId: string) => {
    if (!supabase) return;
    setSavingEdit(true);
    try {
      const devicesJson = JSON.stringify(editForm.devices);
      const updateData = {
        supplier_name: editForm.supplier_name,
        supplier_phone: editForm.supplier_phone,
        rider_name: editForm.rider_name || null,
        rider_phone: editForm.rider_phone || null,
        guarantor_name: editForm.guarantor_name,
        guarantor_phone: editForm.guarantor_phone,
        is_same_person: editForm.is_same_person,
        devices_json: devicesJson,
        device_model: editForm.devices.map(d => d.model).join(', '),
        device_capacity: editForm.devices.map(d => d.capacity).join(', '),
        contract_period: Number(editForm.devices[0]?.period) || 180,
      };
      const { error } = await (supabase.from('uploaded_documents') as any)
        .update(updateData).eq('contract_id', contractId);
      if (error) throw error;
      setDocuments(prev => prev.map(d => d.contract_id === contractId ? { ...d, ...updateData } : d));
      setEditingId(null);
    } catch (error: any) {
      alert(`저장 실패: ${error.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  // 접수 건 삭제
  const handleDeleteSubmission = async (contractId: string) => {
    if (!supabase || !confirm('이 접수 건을 삭제하시겠습니까?')) return;
    try {
      const { error } = await (supabase.from('uploaded_documents') as any).delete().eq('contract_id', contractId);
      if (error) throw error;
      setDocuments(prev => prev.filter(d => d.contract_id !== contractId));
    } catch (error: any) {
      alert(`삭제 실패: ${error.message}`);
    }
  };

  // 접수 건 완료 처리 (목록에서 숨기기)
  const handleHideSubmission = (contractId: string) => {
    setHiddenContracts(prev => new Set(prev).add(contractId));
  };

  const distributorNames = [...new Set(tokens.map(t => t.distributor_name))];

  const filteredDocs = filterDistributor
    ? documents.filter(d => d.distributor_name === filterDistributor)
    : documents;

  // Group documents by contract_id (숨긴 건 제외)
  const groupedDocs = filteredDocs
    .filter(d => !hiddenContracts.has(d.contract_id))
    .reduce<Record<string, UploadedDoc[]>>((acc, doc) => {
      if (!acc[doc.contract_id]) acc[doc.contract_id] = [];
      acc[doc.contract_id].push(doc);
      return acc;
    }, {});

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold text-white">서류 접수 현황</h1>

      {/* Token Generation Section */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h2 className="text-lg font-semibold text-white mb-4">총판 링크 관리</h2>

        <div className="flex gap-3 mb-6">
          <input
            type="text"
            value={newDistributorName}
            onChange={(e) => setNewDistributorName(e.target.value)}
            placeholder="총판명 입력"
            className="flex-1 px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onKeyDown={(e) => e.key === 'Enter' && generateToken()}
          />
          <button
            onClick={generateToken}
            disabled={generatingToken || !newDistributorName.trim()}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {generatingToken ? '생성 중...' : '링크 생성'}
          </button>
        </div>

        {/* Token List */}
        <div className="space-y-2">
          {tokens.map(t => (
            <div
              key={t.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                t.is_active ? 'bg-slate-700' : 'bg-slate-700/50'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{t.distributor_name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    t.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {t.is_active ? '활성' : '비활성'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate font-mono">
                  {window.location.origin + window.location.pathname}?token={t.token}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-3">
                <button
                  onClick={() => copyToClipboard(t.token, t.id)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-600 rounded-lg transition-colors"
                  title="URL 복사"
                >
                  {copiedId === t.id ? (
                    <span className="text-green-400 text-xs font-medium">복사됨!</span>
                  ) : (
                    <CopyIcon className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => toggleToken(t.id, t.is_active)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    t.is_active
                      ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  }`}
                >
                  {t.is_active ? '비활성화' : '활성화'}
                </button>
              </div>
            </div>
          ))}
          {tokens.length === 0 && !loading && (
            <p className="text-slate-500 text-sm text-center py-4">생성된 토큰이 없습니다.</p>
          )}
        </div>
      </div>

      {/* Documents Section */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">접수된 서류</h2>
          <div className="flex items-center gap-3">
            <select
              value={filterDistributor}
              onChange={(e) => setFilterDistributor(e.target.value)}
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">전체 총판</option>
              {distributorNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button
              onClick={fetchAll}
              className="px-3 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 transition-colors"
            >
              새로고침
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-indigo-500"></div>
          </div>
        ) : Object.keys(groupedDocs).length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">접수된 서류가 없습니다.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedDocs).map(([contractId, docs]) => {
              const firstDoc = docs[0];
              return (
                <div key={contractId} className="bg-slate-700/50 rounded-xl p-4 border border-slate-600/50">
                  {/* Submission header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white">{firstDoc.distributor_name}</span>
                        {firstDoc.supplier_name && (
                          <span className="text-sm text-slate-300">/ {firstDoc.supplier_name}</span>
                        )}
                      </div>
                      {/* 정보 표시 / 편집 */}
                      {editingId === contractId ? (
                        <div className="mt-3 bg-slate-800 rounded-lg p-4 space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-slate-500">공급자 성명</label>
                              <input type="text" value={editForm.supplier_name} onChange={(e) => setEditForm(p => ({...p, supplier_name: e.target.value}))}
                                className="w-full px-2 py-1.5 bg-slate-700 text-white text-xs rounded border border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-0.5" />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">공급자 연락처</label>
                              <input type="text" value={editForm.supplier_phone} onChange={(e) => setEditForm(p => ({...p, supplier_phone: e.target.value}))}
                                className="w-full px-2 py-1.5 bg-slate-700 text-white text-xs rounded border border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-0.5" />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">보증인 성명</label>
                              <input type="text" value={editForm.guarantor_name} onChange={(e) => setEditForm(p => ({...p, guarantor_name: e.target.value}))}
                                className="w-full px-2 py-1.5 bg-slate-700 text-white text-xs rounded border border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-0.5" />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">보증인 연락처</label>
                              <input type="text" value={editForm.guarantor_phone} onChange={(e) => setEditForm(p => ({...p, guarantor_phone: e.target.value}))}
                                className="w-full px-2 py-1.5 bg-slate-700 text-white text-xs rounded border border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-0.5" />
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <label className="text-xs text-slate-500">공급자=구매자</label>
                            <button onClick={() => setEditForm(p => ({...p, is_same_person: !p.is_same_person}))}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${editForm.is_same_person ? 'bg-indigo-500' : 'bg-slate-600'}`}>
                              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${editForm.is_same_person ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                          </div>
                          {!editForm.is_same_person && (
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-slate-500">라이더 성명</label>
                                <input type="text" value={editForm.rider_name} onChange={(e) => setEditForm(p => ({...p, rider_name: e.target.value}))}
                                  className="w-full px-2 py-1.5 bg-slate-700 text-white text-xs rounded border border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-0.5" />
                              </div>
                              <div>
                                <label className="text-xs text-slate-500">라이더 연락처</label>
                                <input type="text" value={editForm.rider_phone} onChange={(e) => setEditForm(p => ({...p, rider_phone: e.target.value}))}
                                  className="w-full px-2 py-1.5 bg-slate-700 text-white text-xs rounded border border-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 mt-0.5" />
                              </div>
                            </div>
                          )}
                          <div>
                            <label className="text-xs text-slate-500 mb-1 block">기기 목록</label>
                            {editForm.devices.map((dev, di) => (
                              <div key={di} className="flex items-center gap-2 mb-1.5">
                                <input type="text" value={dev.model} onChange={(e) => { const n = [...editForm.devices]; n[di] = {...n[di], model: e.target.value}; setEditForm(p => ({...p, devices: n})); }}
                                  placeholder="기종" className="flex-1 px-2 py-1 bg-slate-700 text-white text-xs rounded border border-slate-600" />
                                <input type="text" value={dev.capacity} onChange={(e) => { const n = [...editForm.devices]; n[di] = {...n[di], capacity: e.target.value}; setEditForm(p => ({...p, devices: n})); }}
                                  placeholder="용량" className="w-20 px-2 py-1 bg-slate-700 text-white text-xs rounded border border-slate-600" />
                                <input type="number" min="1" value={dev.quantity} onChange={(e) => { const n = [...editForm.devices]; n[di] = {...n[di], quantity: Math.max(1, parseInt(e.target.value) || 1)}; setEditForm(p => ({...p, devices: n})); }}
                                  className="w-14 px-2 py-1 bg-slate-700 text-white text-xs rounded border border-slate-600" />
                                <select value={dev.period} onChange={(e) => { const n = [...editForm.devices]; n[di] = {...n[di], period: e.target.value}; setEditForm(p => ({...p, devices: n})); }}
                                  className="w-20 px-1 py-1 bg-slate-700 text-white text-xs rounded border border-slate-600">
                                  <option value="180">180일</option><option value="210">210일</option>
                                </select>
                                {editForm.devices.length > 1 && (
                                  <button onClick={() => setEditForm(p => ({...p, devices: p.devices.filter((_, i) => i !== di)}))} className="text-red-400 text-xs">✕</button>
                                )}
                              </div>
                            ))}
                            <button onClick={() => setEditForm(p => ({...p, devices: [...p.devices, { model: '', capacity: '', quantity: 1, period: '180' }]}))}
                              className="text-xs text-indigo-400 hover:text-indigo-300 mt-1">+ 기기 추가</button>
                          </div>
                          <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                            <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-300 px-3 py-1.5">취소</button>
                            <button onClick={() => saveEditing(contractId)} disabled={savingEdit}
                              className="text-xs bg-indigo-600 text-white px-4 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">{savingEdit ? '저장 중...' : '저장'}</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                            {firstDoc.supplier_phone && <span className="text-xs text-slate-400">공급자: {firstDoc.supplier_name} ({firstDoc.supplier_phone})</span>}
                            {firstDoc.guarantor_name && <span className="text-xs text-slate-400">보증인: {firstDoc.guarantor_name} ({firstDoc.guarantor_phone})</span>}
                            {firstDoc.rider_name && <span className="text-xs text-slate-400">라이더: {firstDoc.rider_name} ({firstDoc.rider_phone})</span>}
                          </div>
                          <div className="mt-2 flex items-start gap-2">
                            <div className="flex flex-wrap gap-x-3 gap-y-1 flex-1">
                              {(() => {
                                let deviceList: DeviceItem[] = [];
                                if (firstDoc.devices_json) { try { deviceList = JSON.parse(firstDoc.devices_json); } catch {} }
                                if (deviceList.length > 0) {
                                  return deviceList.map((d, i) => (
                                    <span key={i} className="text-xs bg-slate-600/50 px-2 py-0.5 rounded text-slate-300">
                                      {d.model} {d.capacity} x{d.quantity} ({d.period}일)
                                    </span>
                                  ));
                                }
                                return (
                                  <>
                                    {firstDoc.device_model && <span className="text-xs text-slate-400">{firstDoc.device_model}</span>}
                                    {firstDoc.device_capacity && <span className="text-xs text-slate-400">{firstDoc.device_capacity}</span>}
                                    {firstDoc.contract_period && <span className="text-xs text-slate-400">{firstDoc.contract_period}일</span>}
                                  </>
                                );
                              })()}
                            </div>
                            <button onClick={() => startEditing(contractId, docs)}
                              className="text-xs text-yellow-400 hover:text-yellow-300 px-2 py-0.5 rounded hover:bg-slate-600/50 transition-colors whitespace-nowrap">
                              수정
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {new Date(firstDoc.uploaded_at).toLocaleString('ko-KR')}
                      </span>
                      {createdContracts.has(contractId) ? (
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 rounded-lg font-medium">
                            등록 완료
                          </span>
                          <button onClick={() => handleHideSubmission(contractId)}
                            className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-300 rounded-lg hover:bg-slate-600/50">완료</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCreateContract(contractId, docs)}
                            disabled={creatingContract === contractId}
                            className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                          >
                            {creatingContract === contractId ? '등록 중...' : '계약 등록'}
                          </button>
                          <button onClick={() => handleDeleteSubmission(contractId)}
                            className="px-2 py-1.5 text-xs text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10">삭제</button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Document list */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {docs.map(doc => (
                      <div
                        key={doc.id}
                        className="flex items-center gap-3 bg-slate-800/60 rounded-lg p-3"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-200 truncate">
                            {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                          </p>
                          <p className="text-xs text-slate-500 truncate">{doc.file_name}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setPreviewUrl(doc.file_url)}
                            className="px-2 py-1 text-xs bg-indigo-500/20 text-indigo-400 rounded hover:bg-indigo-500/30 transition-colors"
                          >
                            보기
                          </button>
                          <a
                            href={doc.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="px-2 py-1 text-xs bg-slate-600/50 text-slate-300 rounded hover:bg-slate-600 transition-colors"
                          >
                            다운
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Image Preview Modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full">
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-10 right-0 text-white text-2xl hover:text-gray-300"
            >
              &times; 닫기
            </button>
            <img
              src={previewUrl}
              alt="미리보기"
              className="w-full h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};
