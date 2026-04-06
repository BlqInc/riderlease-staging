import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

interface UploadSlot {
  key: string;
  label: string;
  file: File | null;
  preview: string | null;
  uploading: boolean;
  progress: number;
  uploaded: boolean;
}

const CameraIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const SAME_PERSON_SLOTS = [
  { key: 'business_registration', label: '사업자등록증' },
  { key: 'supplier_id', label: '대표자(공급자) 신분증' },
  { key: 'supplier_resident', label: '대표자(공급자) 등본' },
  { key: 'biz_cert_original', label: '사업자등록증명 원본' },
  { key: 'guarantor_id', label: '보증인(구매자) 신분증' },
  { key: 'guarantor_resident', label: '보증인(구매자) 등본' },
];

const DIFF_PERSON_SLOTS = [
  { key: 'business_registration', label: '사업자등록증' },
  { key: 'biz_cert_original', label: '사업자등록증명 원본' },
  { key: 'rider_id', label: '라이더(구매자) 신분증' },
  { key: 'rider_resident', label: '라이더(구매자) 등본' },
  { key: 'guarantor_id', label: '보증인(공급자) 신분증' },
  { key: 'guarantor_resident', label: '보증인(공급자) 등본' },
];

interface SubmissionGroup {
  contract_id: string;
  supplier_name: string;
  device_model: string;
  device_capacity: string;
  contract_period: number;
  is_same_person: boolean;
  uploaded_at: string;
  review_status: string;
  documents: { doc_type: string; file_name: string; file_url: string; id: string; review_memo?: string }[];
}

export const DistributorUpload: React.FC = () => {
  const [tokenParam, setTokenParam] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<any>(null);
  const [validating, setValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);

  // View mode: 'list' = 이전 내역, 'new' = 새 등록, 'detail' = 상세 보기
  const [viewMode, setViewMode] = useState<'list' | 'new' | 'detail'>('list');
  const [previousSubmissions, setPreviousSubmissions] = useState<SubmissionGroup[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionGroup | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [listSearch, setListSearch] = useState('');

  // Form state (consolidated)
  const [formState, setFormState] = useState({
    supplierName: '',
    supplierPhone: '',
    riderName: '',
    riderPhone: '',
    guarantorName: '',
    guarantorPhone: '',
    isSamePerson: true,
  });
  const [devices, setDevices] = useState<{ model: string; capacity: string; quantity: number; period: '180' | '210' }[]>([
    { model: '', capacity: '', quantity: 1, period: '180' },
  ]);

  // Upload state
  const [slots, setSlots] = useState<UploadSlot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  // Extract token from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    setTokenParam(token);
  }, []);

  // 브라우저 뒤로가기 지원
  useEffect(() => {
    const handlePopState = () => {
      if (viewMode === 'detail') setViewMode('list');
      else if (viewMode === 'new') setViewMode('list');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [viewMode]);

  // 화면 전환 시 히스토리 push
  const navigateTo = (mode: 'list' | 'new' | 'detail') => {
    if (mode !== 'list') window.history.pushState({ mode }, '');
    setViewMode(mode);
  };

  // Validate token
  useEffect(() => {
    if (!tokenParam || !supabase) {
      setValidating(false);
      return;
    }

    const validate = async () => {
      try {
        const { data, error } = await (supabase.from('distributor_tokens') as any)
          .select('*')
          .eq('token', tokenParam)
          .eq('is_active', true)
          .single();

        if (error || !data) {
          setIsValid(false);
        } else {
          setTokenData(data);
          setIsValid(true);
        }
      } catch {
        setIsValid(false);
      } finally {
        setValidating(false);
      }
    };

    validate();
  }, [tokenParam]);

  // Fetch previous submissions
  const fetchPreviousSubmissions = async () => {
    if (!supabase || !tokenData) return;
    setLoadingHistory(true);
    try {
      const { data, error } = await (supabase.from('uploaded_documents') as any)
        .select('*')
        .eq('token_id', tokenData.id)
        .order('uploaded_at', { ascending: false });

      if (error || !data) { setPreviousSubmissions([]); return; }

      // Group by contract_id
      const groups = new Map<string, SubmissionGroup>();
      for (const doc of data) {
        if (!groups.has(doc.contract_id)) {
          groups.set(doc.contract_id, {
            contract_id: doc.contract_id,
            supplier_name: doc.supplier_name || '',
            device_model: doc.device_model || '',
            device_capacity: doc.device_capacity || '',
            contract_period: doc.contract_period || 180,
            is_same_person: doc.is_same_person ?? true,
            uploaded_at: doc.uploaded_at,
            review_status: doc.review_status || '서류 검토 중',
            documents: [],
          });
        }
        groups.get(doc.contract_id)!.documents.push({
          doc_type: doc.doc_type,
          file_name: doc.file_name,
          file_url: doc.file_url,
          id: doc.id,
          review_memo: doc.review_memo || undefined,
        });
      }
      setPreviousSubmissions(Array.from(groups.values()));
    } catch {
      setPreviousSubmissions([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (tokenData) fetchPreviousSubmissions();
  }, [tokenData]);

  // Initialize slots when isSamePerson changes
  useEffect(() => {
    const slotDefs = formState.isSamePerson ? SAME_PERSON_SLOTS : DIFF_PERSON_SLOTS;
    setSlots(slotDefs.map(s => ({
      key: s.key,
      label: s.label,
      file: null,
      preview: null,
      uploading: false,
      progress: 0,
      uploaded: false,
    })));
  }, [formState.isSamePerson]);

  const addDevice = () => setDevices(prev => [...prev, { model: '', capacity: '', quantity: 1, period: '180' }]);
  const removeDevice = (idx: number) => setDevices(prev => prev.filter((_, i) => i !== idx));
  const updateDevice = (idx: number, field: string, value: string | number) => {
    setDevices(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  };

  const handleFileSelect = (slotKey: string, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setSlots(prev => prev.map(s =>
        s.key === slotKey
          ? { ...s, file, preview: e.target?.result as string }
          : s
      ));
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = (slotKey: string) => {
    setSlots(prev => prev.map(s =>
      s.key === slotKey
        ? { ...s, file: null, preview: null, uploaded: false, progress: 0 }
        : s
    ));
  };

  const handleSubmit = async () => {
    if (!supabase || !tokenData) return;

    // Validation
    if (!formState.supplierName.trim()) {
      setSubmitError('대표자(공급자) 성명을 입력해주세요.');
      return;
    }
    if (!formState.supplierPhone.trim()) {
      setSubmitError('대표자(공급자) 휴대폰번호를 입력해주세요.');
      return;
    }
    if (!formState.isSamePerson && !formState.riderName.trim()) {
      setSubmitError('라이더(구매자) 성명을 입력해주세요.');
      return;
    }
    if (!formState.isSamePerson && !formState.riderPhone.trim()) {
      setSubmitError('라이더(구매자) 휴대폰번호를 입력해주세요.');
      return;
    }
    if (!formState.guarantorName.trim()) {
      setSubmitError('보증인 성명을 입력해주세요.');
      return;
    }
    if (!formState.guarantorPhone.trim()) {
      setSubmitError('보증인 휴대폰번호를 입력해주세요.');
      return;
    }
    if (devices.some(d => !d.model.trim())) {
      setSubmitError('기종을 입력해주세요.');
      return;
    }
    if (devices.some(d => !d.capacity.trim())) {
      setSubmitError('용량을 입력해주세요.');
      return;
    }

    const filledSlots = slots.filter(s => s.file);
    if (filledSlots.length === 0) {
      setSubmitError('최소 1개 이상의 서류를 업로드해주세요.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const timestamp = Date.now();
      const contractId = `${tokenData.distributor_name}_${formState.supplierName}_${timestamp}`;

      for (const slot of filledSlots) {
        if (!slot.file) continue;

        // Update progress
        setSlots(prev => prev.map(s =>
          s.key === slot.key ? { ...s, uploading: true, progress: 30 } : s
        ));

        const ext = slot.file.name.split('.').pop() || 'jpg';
        const filePath = `${tokenParam}/${slot.key}_${timestamp}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, slot.file);

        if (uploadError) throw new Error(`${slot.label} 업로드 실패: ${uploadError.message}`);

        setSlots(prev => prev.map(s =>
          s.key === slot.key ? { ...s, progress: 70 } : s
        ));

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('documents')
          .getPublicUrl(filePath);

        // Save record
        const { error: dbError } = await (supabase.from('uploaded_documents') as any).insert({
          token_id: tokenData.id,
          distributor_name: tokenData.distributor_name,
          contract_id: contractId,
          doc_type: slot.key,
          file_name: slot.file.name,
          file_url: urlData?.publicUrl || filePath,
          supplier_name: formState.supplierName,
          supplier_phone: formState.supplierPhone,
          rider_name: !formState.isSamePerson ? formState.riderName : null,
          rider_phone: !formState.isSamePerson ? formState.riderPhone : null,
          guarantor_name: formState.guarantorName,
          guarantor_phone: formState.guarantorPhone,
          device_model: devices.map(d => d.model).join(', '),
          device_capacity: devices.map(d => d.capacity).join(', '),
          contract_period: Number(devices[0]?.period) || 180,
          is_same_person: formState.isSamePerson,
          devices_json: JSON.stringify(devices),
        });

        if (dbError) throw new Error(`${slot.label} 저장 실패: ${dbError.message}`);

        setSlots(prev => prev.map(s =>
          s.key === slot.key ? { ...s, uploading: false, progress: 100, uploaded: true } : s
        ));
      }

      setSubmitted(true);
      // 목록 새로고침
      await fetchPreviousSubmissions();
    } catch (error: any) {
      setSubmitError(error.message || '업로드 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  // 새 건 등록으로 전환
  const startNewSubmission = () => {
    navigateTo('new');
    setSubmitted(false);
    setSubmitError(null);
    setFormState({
      supplierName: '',
      supplierPhone: '',
      riderName: '',
      riderPhone: '',
      guarantorName: '',
      guarantorPhone: '',
      isSamePerson: true,
    });
    setDevices([{ model: '', capacity: '', quantity: 1, period: '180' }]);
  };

  // 제출 건 상세 보기
  const viewSubmissionDetail = (sub: SubmissionGroup) => {
    setSelectedSubmission(sub);
    navigateTo('detail');
  };

  // doc_type에 맞는 라벨 찾기
  const getDocLabel = (docType: string, isSame: boolean) => {
    const allSlots = [...SAME_PERSON_SLOTS, ...DIFF_PERSON_SLOTS];
    return allSlots.find(s => s.key === docType)?.label || docType;
  };

  // Loading
  if (validating) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-500 text-sm">확인 중...</p>
        </div>
      </div>
    );
  }

  // Invalid token
  if (!isValid || !tokenParam) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">유효하지 않은 링크입니다</h2>
          <p className="text-gray-500 text-sm">관리자에게 문의해주세요.</p>
        </div>
      </div>
    );
  }

  // Success
  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckIcon className="w-8 h-8 text-green-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">제출 완료</h2>
          <p className="text-gray-500 text-sm mb-6">서류가 성공적으로 제출되었습니다.<br />감사합니다.</p>
          <div className="space-y-2">
            <button
              onClick={() => { navigateTo('list'); setSubmitted(false); }}
              className="w-full py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors"
            >
              제출 내역 보기
            </button>
            <button
              onClick={startNewSubmission}
              className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-colors"
            >
              새 건 등록하기
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── 이전 제출 내역 목록 ───
  if (viewMode === 'list') {
    // 보완 필요 건을 맨 위로 정렬
    const sorted = [...previousSubmissions].sort((a, b) => {
      if (a.review_status === '보완 필요' && b.review_status !== '보완 필요') return -1;
      if (b.review_status === '보완 필요' && a.review_status !== '보완 필요') return 1;
      return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime();
    });

    // 검색 필터
    const filtered = listSearch
      ? sorted.filter(sub =>
          (sub.supplier_name || '').toLowerCase().includes(listSearch.toLowerCase()) ||
          (sub.device_model || '').toLowerCase().includes(listSearch.toLowerCase())
        )
      : sorted;

    // 삭제 핸들러
    const handleDeleteSubmission = async (contractId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!supabase || !confirm('이 제출 건을 삭제하시겠습니까?')) return;
      try {
        await (supabase.from('uploaded_documents') as any).delete().eq('contract_id', contractId);
        setPreviousSubmissions(prev => prev.filter(s => s.contract_id !== contractId));
      } catch { alert('삭제 실패'); }
    };

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-lg mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-gray-800">서류 관리</h1>
                <p className="text-xs text-gray-500">{tokenData?.distributor_name}</p>
              </div>
              <button
                onClick={startNewSubmission}
                className="bg-blue-500 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-blue-600 active:bg-blue-700 transition-colors flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                새 건 등록
              </button>
            </div>
            {/* 검색 */}
            {previousSubmissions.length > 0 && (
              <div className="mt-3">
                <input
                  type="text"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="이름, 기기명 검색..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                />
              </div>
            )}
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-4">
          {loadingHistory ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
              <p className="text-gray-400 text-sm">{listSearch ? '검색 결과가 없습니다.' : '아직 제출된 내역이 없습니다.'}</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
              {filtered.map((sub) => {
                const hasIssue = sub.documents.some(d => d.review_memo);
                const canDelete = sub.review_status === '서류 검토 중';
                return (
                  <div
                    key={sub.contract_id}
                    onClick={() => viewSubmissionDetail(sub)}
                    className="flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors"
                  >
                    {/* 상태 인디케이터 */}
                    <div className={`w-2 h-2 rounded-full shrink-0 mr-3 ${
                      hasIssue ? 'bg-red-500' :
                      sub.review_status === '진행중' ? 'bg-green-500' :
                      sub.review_status === '서류 확인 완료' ? 'bg-blue-500' :
                      sub.review_status === '계약서 발송' ? 'bg-purple-500' :
                      'bg-gray-300'
                    }`} />
                    {/* 정보 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-gray-800 truncate">{sub.supplier_name || '이름 없음'}</span>
                        {hasIssue && <span className="text-[10px] bg-red-500 text-white px-1 py-0.5 rounded font-bold shrink-0">보완</span>}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{sub.device_model} · {sub.contract_period}일 · {new Date(sub.uploaded_at).toLocaleDateString('ko-KR')}</p>
                    </div>
                    {/* 상태 뱃지 */}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ml-2 ${
                      sub.review_status === '보완 필요' ? 'bg-red-100 text-red-600' :
                      sub.review_status === '서류 확인 완료' ? 'bg-blue-100 text-blue-600' :
                      sub.review_status === '계약서 발송' ? 'bg-purple-100 text-purple-600' :
                      sub.review_status === '진행중' ? 'bg-green-100 text-green-600' :
                      'bg-gray-100 text-gray-500'
                    }`}>{sub.review_status}</span>
                    {/* 삭제 버튼 */}
                    {canDelete && (
                      <button
                        onClick={(e) => handleDeleteSubmission(sub.contract_id, e)}
                        className="ml-2 text-gray-300 hover:text-red-400 shrink-0 p-1"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-center text-xs text-gray-400 mt-4">{filtered.length}건</p>
        </div>
      </div>
    );
  }

  // ─── 제출 건 상세 보기 ───
  if (viewMode === 'detail' && selectedSubmission) {
    const sub = selectedSubmission;
    const slotDefs = sub.is_same_person ? SAME_PERSON_SLOTS : DIFF_PERSON_SLOTS;

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
            <button onClick={() => window.history.back()} className="text-blue-500 hover:text-blue-600">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-800">{sub.supplier_name}</h1>
              <p className="text-xs text-gray-500">{sub.device_model} {sub.device_capacity} · {sub.contract_period}일</p>
            </div>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-2">
              제출일: {new Date(sub.uploaded_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="text-sm text-gray-600">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${sub.is_same_person ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                {sub.is_same_person ? '공급자=구매자 동일' : '공급자≠구매자'}
              </span>
            </p>
          </div>

          <h3 className="text-sm font-semibold text-gray-500">제출된 서류</h3>
          <div className="space-y-3">
            {slotDefs.map((slotDef, idx) => {
              const doc = sub.documents.find(d => d.doc_type === slotDef.key);
              return (
                <div key={slotDef.key} className={`bg-white rounded-xl shadow-sm overflow-hidden ${doc?.review_memo ? 'border-2 border-red-300' : 'border border-gray-100'}`}>
                  <div className="flex items-center p-3">
                    <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold mr-3 ${doc?.review_memo ? 'bg-red-100 text-red-500' : 'bg-gray-200 text-gray-500'}`}>
                      {doc?.review_memo ? '!' : idx + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-700 flex-1">{slotDef.label}</span>
                    {doc ? (
                      doc.review_memo ? (
                        <span className="text-xs text-red-500 font-medium">보완 필요</span>
                      ) : (
                        <span className="text-green-500"><CheckIcon className="w-5 h-5" /></span>
                      )
                    ) : (
                      <span className="text-xs text-red-400 font-medium">미제출</span>
                    )}
                  </div>
                  {/* 반려 메모 표시 */}
                  {doc?.review_memo && (
                    <div className="mx-3 mb-2 bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-xs text-red-600 font-medium mb-1">보완 요청</p>
                      <p className="text-sm text-red-700">{doc.review_memo}</p>
                    </div>
                  )}
                  {doc && (
                    <div className="px-3 pb-3">
                      <img src={doc.file_url} alt={slotDef.label} className="w-full h-40 object-cover rounded-lg bg-gray-100" />
                      <p className="text-xs text-gray-400 mt-1.5 truncate">{doc.file_name}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─── 새 건 등록 폼 ───
  const filledCount = slots.filter(s => s.file).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          {previousSubmissions.length > 0 && (
            <button onClick={() => window.history.back()} className="text-blue-500 hover:text-blue-600">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}
          <div>
            <h1 className="text-lg font-bold text-gray-800">새 건 등록</h1>
            <p className="text-xs text-gray-500 mt-0.5">{tokenData?.distributor_name}</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Basic Info Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-base font-bold text-gray-800 mb-4">기본 정보</h2>

          {/* Same person toggle */}
          <div className="flex items-center justify-between mb-5 bg-gray-50 rounded-xl p-4">
            <span className="text-sm font-medium text-gray-700">공급자 = 구매자 동일</span>
            <button
              type="button"
              onClick={() => setFormState(prev => ({ ...prev, isSamePerson: !prev.isSamePerson }))}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                formState.isSamePerson ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                  formState.isSamePerson ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">대표자(공급자) 성명</label>
              <input
                type="text"
                value={formState.supplierName}
                onChange={(e) => setFormState(prev => ({ ...prev, supplierName: e.target.value }))}
                placeholder="성명 입력"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">대표자(공급자) 휴대폰번호</label>
              <input
                type="tel"
                value={formState.supplierPhone}
                onChange={(e) => setFormState(prev => ({ ...prev, supplierPhone: e.target.value }))}
                placeholder="010-0000-0000"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              />
            </div>

            {!formState.isSamePerson && (
              <>
                <div className="border-t border-gray-100 pt-4">
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">라이더(구매자) 성명</label>
                  <input
                    type="text"
                    value={formState.riderName}
                    onChange={(e) => setFormState(prev => ({ ...prev, riderName: e.target.value }))}
                    placeholder="성명 입력"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1.5">라이더(구매자) 휴대폰번호</label>
                  <input
                    type="tel"
                    value={formState.riderPhone}
                    onChange={(e) => setFormState(prev => ({ ...prev, riderPhone: e.target.value }))}
                    placeholder="010-0000-0000"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  />
                </div>
              </>
            )}

            <div className="border-t border-gray-100 pt-4">
              <label className="block text-sm font-medium text-gray-600 mb-1.5">보증인 성명</label>
              <input
                type="text"
                value={formState.guarantorName}
                onChange={(e) => setFormState(prev => ({ ...prev, guarantorName: e.target.value }))}
                placeholder="성명 입력"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1.5">보증인 휴대폰번호</label>
              <input
                type="tel"
                value={formState.guarantorPhone}
                onChange={(e) => setFormState(prev => ({ ...prev, guarantorPhone: e.target.value }))}
                placeholder="010-0000-0000"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              />
            </div>
          </div>
        </div>

        {/* Device & Contract Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-800">기기 / 계약 선택</h2>
            <span className="text-xs text-gray-400">{devices.length}개 기기</span>
          </div>

          <div className="space-y-4">
            {devices.map((device, idx) => (
              <div key={idx} className={`space-y-3 ${idx > 0 ? 'pt-4 border-t border-gray-100' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-600">기기 {idx + 1}</span>
                  {devices.length > 1 && (
                    <button type="button" onClick={() => removeDevice(idx)} className="text-red-400 hover:text-red-500 text-xs font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                      삭제
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">기종</label>
                    <input
                      type="text" value={device.model}
                      onChange={(e) => updateDevice(idx, 'model', e.target.value)}
                      placeholder="iPhone 16 Pro"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">용량</label>
                    <input
                      type="text" value={device.capacity}
                      onChange={(e) => updateDevice(idx, 'capacity', e.target.value)}
                      placeholder="256GB"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">수량</label>
                    <input
                      type="number" min="1" value={device.quantity}
                      onChange={(e) => updateDevice(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">계약기간</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button type="button" onClick={() => updateDevice(idx, 'period', '180')}
                        className={`py-2.5 rounded-lg text-sm font-medium transition-all ${device.period === '180' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        180일
                      </button>
                      <button type="button" onClick={() => updateDevice(idx, 'period', '210')}
                        className={`py-2.5 rounded-lg text-sm font-medium transition-all ${device.period === '210' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        210일
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addDevice}
              className="w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-500 text-sm font-medium transition-colors flex items-center justify-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              기기 추가
            </button>
          </div>

          {/* 예상 매출/수수료 계산 */}
          {devices.some(d => d.model && d.capacity) && (
            <div className="mt-4 bg-blue-50 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-blue-800">예상 계약 요약</h3>
              {devices.filter(d => d.model).map((d, i) => {
                const totalDays = Number(d.period) || 180;
                const totalDevices = d.quantity || 1;
                return (
                  <div key={i} className="flex justify-between items-center text-xs">
                    <span className="text-blue-600">{d.model} {d.capacity} x{totalDevices}</span>
                    <span className="text-blue-700 font-medium">{totalDays}일 계약</span>
                  </div>
                );
              })}
              <div className="border-t border-blue-200 pt-2 mt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-blue-600 font-medium">총 기기 수</span>
                  <span className="text-blue-800 font-bold">{devices.reduce((s, d) => s + (d.quantity || 0), 0)}대</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Upload Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-800">서류 업로드</h2>
            <span className="text-xs text-gray-400">{filledCount}/{slots.length}</span>
          </div>

          <div className="space-y-3">
            {slots.map((slot, idx) => (
              <div key={slot.key} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center p-3 bg-gray-50">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 text-xs font-bold text-gray-500 mr-3">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium text-gray-700 flex-1">{slot.label}</span>
                  {slot.uploaded && (
                    <span className="flex items-center text-green-500">
                      <CheckIcon className="w-5 h-5" />
                    </span>
                  )}
                  {slot.file && !slot.uploaded && (
                    <span className="text-xs text-blue-500 font-medium">준비됨</span>
                  )}
                </div>

                {slot.preview ? (
                  <div className="relative p-3">
                    <img
                      src={slot.preview}
                      alt={slot.label}
                      className="w-full h-40 object-cover rounded-lg"
                    />
                    {slot.uploading && (
                      <div className="absolute inset-3 bg-black/40 rounded-lg flex items-center justify-center">
                        <div className="w-3/4">
                          <div className="bg-white/30 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-white h-full rounded-full transition-all duration-500"
                              style={{ width: `${slot.progress}%` }}
                            />
                          </div>
                          <p className="text-white text-xs text-center mt-2">업로드 중...</p>
                        </div>
                      </div>
                    )}
                    {!slot.uploading && !slot.uploaded && (
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(slot.key)}
                        className="absolute top-5 right-5 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm hover:bg-black/70"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRefs.current[slot.key]?.click()}
                    className="w-full p-6 flex flex-col items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50/50 transition-colors"
                  >
                    <CameraIcon className="w-8 h-8 mb-1" />
                    <span className="text-xs">탭하여 업로드</span>
                  </button>
                )}

                <input
                  ref={(el) => { fileInputRefs.current[slot.key] = el; }}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(slot.key, file);
                    e.target.value = '';
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Error */}
        {submitError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-red-600 text-sm">{submitError}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || filledCount === 0}
          className={`w-full py-4 rounded-2xl text-base font-bold transition-all shadow-sm ${
            submitting || filledCount === 0
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700'
          }`}
        >
          {submitting ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              제출 중...
            </span>
          ) : (
            `서류 제출하기 (${filledCount}/${slots.length})`
          )}
        </button>

        <div className="h-8" />
      </div>
    </div>
  );
};
