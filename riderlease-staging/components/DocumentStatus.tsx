import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

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
}

const DOC_TYPE_LABELS: Record<string, string> = {
  business_registration: '사업자등록증',
  supplier_id: '대표자(공급자) 신분증',
  supplier_resident: '대표자(공급자) 등본',
  biz_cert_original: '사업자등록증명 원본',
  biz_cert_blq: '사업자등록증명 비엘큐용',
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

export const DocumentStatus: React.FC = () => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDistributorName, setNewDistributorName] = useState('');
  const [generatingToken, setGeneratingToken] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterDistributor, setFilterDistributor] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  const distributorNames = [...new Set(tokens.map(t => t.distributor_name))];

  const filteredDocs = filterDistributor
    ? documents.filter(d => d.distributor_name === filterDistributor)
    : documents;

  // Group documents by contract_id
  const groupedDocs = filteredDocs.reduce<Record<string, UploadedDoc[]>>((acc, doc) => {
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
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                        {firstDoc.device_model && (
                          <span className="text-xs text-slate-400">기종: {firstDoc.device_model}</span>
                        )}
                        {firstDoc.device_capacity && (
                          <span className="text-xs text-slate-400">용량: {firstDoc.device_capacity}</span>
                        )}
                        {firstDoc.contract_period && (
                          <span className="text-xs text-slate-400">계약: {firstDoc.contract_period}일</span>
                        )}
                        {firstDoc.supplier_phone && (
                          <span className="text-xs text-slate-400">공급자: {firstDoc.supplier_phone}</span>
                        )}
                        {firstDoc.guarantor_name && (
                          <span className="text-xs text-slate-400">보증인: {firstDoc.guarantor_name} ({firstDoc.guarantor_phone})</span>
                        )}
                        {firstDoc.rider_name && (
                          <span className="text-xs text-slate-400">라이더: {firstDoc.rider_name} ({firstDoc.rider_phone})</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-slate-400 whitespace-nowrap ml-3">
                      {new Date(firstDoc.uploaded_at).toLocaleString('ko-KR')}
                    </span>
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
