import React, { useState, useMemo, Fragment, useRef } from 'react';
import { Contract, ContractStatus, Partner, DeductionStatus, SettlementStatus, ShippingStatus, ProcurementStatus } from '../types';
import { formatDate, formatCurrency } from '../lib/utils';
import { PlusIcon, ChevronDownIcon, DuplicateIcon, UserPlusIcon, UploadIcon } from './icons/IconComponents';
import { read, utils } from 'xlsx';
import { computeDistributorRisk, computeLesseeRisk, classifyRisk, riskColors, RiskLevel } from '../lib/riskUtils';

interface ContractManagementProps {
  contracts: Contract[];
  partners: Partner[];
  onSelectContract: (contract: Contract) => void;
  onAddContract: (template?: Partial<Contract>) => void;
  onImportContracts: (contracts: Partial<Omit<Contract, 'id' | 'contract_number' | 'unpaid_balance'>>[]) => Promise<void>;
  onDeleteContracts?: (ids: string[]) => Promise<void>;
}

interface ContractGroup {
  key: string;
  distributor_name: string;
  lessee_name: string;
  contractCount: number;
  totalUnits: number;
  totalAmount: number;
  totalRemaining: number;
  contracts: Contract[];
}

const StatusBadge: React.FC<{ status: ContractStatus }> = ({ status }) => {
  const baseClasses = "px-2 py-1 text-xs font-semibold rounded-full";
  const statusClasses = {
    [ContractStatus.ACTIVE]: "bg-green-500/20 text-green-300",
    [ContractStatus.EXPIRED]: "bg-yellow-500/20 text-yellow-300",
    [ContractStatus.SETTLED]: "bg-sky-500/20 text-sky-300",
  };
  return <span className={`${baseClasses} ${statusClasses[status]}`}>{status}</span>;
};

const MiniRiskBadge: React.FC<{ level: RiskLevel }> = ({ level }) => {
  if (level === '정상') return null;
  return <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-semibold rounded ${riskColors[level]}`}>{level}</span>;
};

export const ContractManagement: React.FC<ContractManagementProps> = ({ contracts, partners, onSelectContract, onAddContract, onImportContracts, onDeleteContracts }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [importStatus, setImportStatus] = useState({ loading: false, message: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportStatus({ loading: true, message: '파일을 분석 중입니다...' });

    try {
        const data = await file.arrayBuffer();
        const workbook = read(data);

        // 계약서 엑셀 양식 감지: '고객리스트' 시트가 있으면 계약서 양식
        const isContractExcel = workbook.SheetNames.includes('고객리스트');

        let newContracts: Partial<Omit<Contract, 'id' | 'contract_number' | 'unpaid_balance'>>[] = [];
        const errors: string[] = [];
        const partnerNameToIdMap = new Map(partners.map(p => [p.name.trim().toLowerCase(), p.id]));

        if (isContractExcel) {
          // ─── 계약서 엑셀 양식 파싱 ───
          const customerSheet = workbook.Sheets['고객리스트'];
          const rawData: any[][] = utils.sheet_to_json(customerSheet, { header: 1 });

          // 헤더 찾기 (Row 6: "계약번호" 포함된 행)
          let headerIdx = -1;
          for (let i = 0; i < Math.min(rawData.length, 15); i++) {
            if (rawData[i]?.some((c: any) => String(c || '').includes('계약번호'))) {
              headerIdx = i;
              break;
            }
          }
          if (headerIdx === -1) throw new Error('고객리스트 시트에서 헤더 행(계약번호)을 찾을 수 없습니다.');

          const headers = rawData[headerIdx].map((h: any) => String(h || '').trim());

          // 상품리스트에서 가격 정보 가져오기
          // 컬럼: [EX, 총판명, 상품명, 1대일출금액(A), 영업수수료(B), 총대수, 최종일출금액(A+B), 계약기간, 총매출액, 공급대금]
          const priceMap = new Map<string, { dailyTotal: number; units: number; period: number; totalRevenue: number }>();
          if (workbook.SheetNames.includes('상품리스트')) {
            const priceSheet = workbook.Sheets['상품리스트'];
            const priceData: any[][] = utils.sheet_to_json(priceSheet, { header: 1 });
            for (let i = 9; i < priceData.length; i++) {
              const row = priceData[i];
              if (!row || !row[2]) continue;
              const productName = String(row[2]).trim();
              if (!productName) continue;
              priceMap.set(productName, {
                dailyTotal: Number(row[6]) || 0,  // 최종 일출금액(A+B) = 전체 대수 기준
                units: Number(row[5]) || 1,        // 총대수
                period: Number(row[7]) || 180,     // 계약기간
                totalRevenue: Number(row[8]) || 0, // 총매출액 = 총 채권액
              });
            }
          }

          // 데이터 행 파싱
          for (let i = headerIdx + 1; i < rawData.length; i++) {
            const row = rawData[i];
            if (!row || row.every((c: any) => c == null || c === '')) continue;

            const getValue = (colName: string): any => {
              const idx = headers.indexOf(colName);
              return idx >= 0 ? row[idx] : null;
            };

            const contractDate = getValue('계약일');
            const deviceName = String(getValue('상품명') || '').trim();
            if (!deviceName) continue; // 상품명 없으면 스킵

            // 계약기간 파싱: "7개월(210일)" → 210, 또는 숫자 그대로
            let durationDays = 180;
            const periodRaw = getValue('계약기간');
            if (periodRaw) {
              const match = String(periodRaw).match(/(\d+)\s*일/);
              if (match) durationDays = parseInt(match[1]);
              else if (!isNaN(Number(periodRaw))) durationDays = Number(periodRaw);
            }

            // 날짜 파싱
            let formattedDate = '';
            if (contractDate) {
              if (typeof contractDate === 'number') {
                const d = new Date(Math.round((contractDate - 25569) * 86400 * 1000));
                formattedDate = d.toISOString().split('T')[0];
              } else if (typeof contractDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(contractDate)) {
                formattedDate = contractDate.split('T')[0];
              }
            }
            if (!formattedDate) formattedDate = new Date().toISOString().split('T')[0];

            // 만료일 계산
            const startParts = formattedDate.split('-').map(Number);
            const startDate = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
            startDate.setUTCDate(startDate.getUTCDate() + durationDays - 1);
            const expiryDate = startDate.toISOString().split('T')[0];

            // 총판(공급자 회사명)으로 파트너 매칭
            const distributorCompany = String(getValue('공급자 회사명') || '').trim();
            const partnerId = partnerNameToIdMap.get(distributorCompany.toLowerCase());

            // 상품리스트에서 가격 매칭
            const priceInfo = priceMap.get(deviceName);
            const dailyDeduction = priceInfo?.dailyTotal || Number(getValue('일 납부금')) || 0;
            const unitsRequired = priceInfo?.units || Number(getValue('상품대수합계')) || 1;
            const totalAmount = priceInfo?.totalRevenue || (dailyDeduction * durationDays);
            if (priceInfo?.period) durationDays = priceInfo.period;

            const newContract: Partial<Contract> = {
              device_name: deviceName,
              color: '',
              contract_date: formattedDate,
              execution_date: '2030-12-31',
              expiry_date: expiryDate,
              duration_days: durationDays,
              total_amount: totalAmount,
              daily_deduction: dailyDeduction,
              units_required: unitsRequired,
              status: ContractStatus.ACTIVE,
              settlement_status: SettlementStatus.NOT_READY,
              is_lessee_contract_signed: false,
              shipping_status: ShippingStatus.PREPARING,
              procurement_status: ProcurementStatus.UNSECURED,
              daily_deductions: null,
              distributor_name: distributorCompany || String(getValue('공급자 성명') || ''),
              distributor_contact: String(getValue('공급자 휴대전화') || ''),
              distributor_business_number: String(getValue('공급자 사업자번호') || ''),
              distributor_address: String(getValue('공급자 회사주소') || ''),
              lessee_name: String(getValue('이용자 성명') || ''),
              lessee_contact: String(getValue('이용자 휴대전화') || ''),
              lessee_business_address: String(getValue('이용자 집주소') || ''),
            };

            if (partnerId) newContract.partner_id = partnerId;

            newContracts.push(newContract);
          }

          if (newContracts.length === 0) {
            throw new Error('가져올 수 있는 계약 데이터가 없습니다. 고객리스트 시트를 확인해주세요.');
          }

        } else {
          // ─── 기존 양식 파싱 ───
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData: Record<string, any>[] = utils.sheet_to_json(worksheet);

          if (!Array.isArray(jsonData)) {
            throw new Error("엑셀 파일의 형식이 올바르지 않습니다.");
          }

          const headerToFieldMap: { [key: string]: keyof Partial<Contract> | 'model' | 'storage' } = {
              '파트너사명': 'partner_id', '기기명': 'model', '용량': 'storage', '색상': 'color',
              '계약일': 'contract_date', '실행일': 'execution_date', '만료일': 'expiry_date',
              '계약 기간': 'duration_days', '총 채권액': 'total_amount',
              '일차감액': 'daily_deduction',
              '일 차감액': 'daily_deduction',
              '계약자(라이더)': 'lessee_name',
              '계약자': 'lessee_name',
              '계약자 연락처': 'lessee_contact',
              '계약자 사업자번호': 'lessee_business_number',
              '계약자 사업자주소': 'lessee_business_address',
              '총판명': 'distributor_name', '필요 수량': 'units_required',
              '정산 차수': 'settlement_round',
          };

          jsonData.forEach((row, index) => {
              const newContract: Partial<Contract> & { model?: string, storage?: string } = {
                  status: ContractStatus.ACTIVE,
                  settlement_status: SettlementStatus.NOT_READY,
                  is_lessee_contract_signed: false,
                  shipping_status: ShippingStatus.PREPARING,
                  procurement_status: ProcurementStatus.UNSECURED,
                  daily_deductions: null,
              };
              let hasError = false;

              for (const rawHeader of Object.keys(row)) {
                  const header = String(rawHeader).trim();
                  const field = headerToFieldMap[header];
                  if (field) {
                      const value = row[rawHeader];
                      if (value === null || value === undefined) continue;

                      if (field === 'partner_id') {
                          const partnerName = String(value).trim().toLowerCase();
                          const partnerId = partnerNameToIdMap.get(partnerName);
                          if (partnerId) {
                              newContract.partner_id = partnerId;
                          } else {
                              errors.push(`Row ${index + 2}: 파트너사 '${String(value)}'을(를) 찾을 수 없습니다.`);
                              hasError = true;
                          }
                      } else if (['contract_date', 'execution_date', 'expiry_date'].includes(field)) {
                          let formattedDate: string | null = null;
                          if (value instanceof Date && !isNaN(value.getTime())) {
                              value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
                              formattedDate = value.toISOString().split('T')[0];
                          } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
                              const d = new Date(value.trim());
                              if (!isNaN(d.getTime())) {
                                  d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
                                  formattedDate = d.toISOString().split('T')[0];
                              }
                          } else if (typeof value === 'number') {
                              const d = new Date(Math.round((value - 25569) * 86400 * 1000));
                              if (!isNaN(d.getTime())) {
                                  formattedDate = d.toISOString().split('T')[0];
                              }
                          }

                          if (formattedDate) {
                              (newContract as any)[field] = formattedDate;
                          } else if (value) {
                              errors.push(`Row ${index + 2}: '${header}'의 날짜 형식이 올바르지 않습니다.`);
                              hasError = true;
                          }
                      } else if (['duration_days', 'total_amount', 'daily_deduction', 'units_required', 'settlement_round'].includes(field)) {
                          const numValue = Number(value);
                          if (!isNaN(numValue)) {
                              (newContract as any)[field] = numValue;
                          } else {
                               errors.push(`Row ${index + 2}: '${header}'은(는) 숫자여야 합니다.`);
                               hasError = true;
                          }
                      }
                      else {
                          (newContract as any)[field] = String(value);
                      }
                  }
              }

              if (newContract.model) {
                  newContract.device_name = [newContract.model, newContract.storage].filter(Boolean).join(' ');
              }
              delete newContract.model;
              delete newContract.storage;

              if (!newContract.execution_date && newContract.contract_date) {
                  newContract.execution_date = newContract.contract_date;
              }

              if (!newContract.expiry_date && newContract.duration_days && newContract.execution_date) {
                  try {
                      const parts = newContract.execution_date.split('-').map(Number);
                      const startDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                      if (isNaN(startDate.getTime())) throw new Error('Invalid date');
                      startDate.setUTCDate(startDate.getUTCDate() + (Number(newContract.duration_days) - 1));
                      newContract.expiry_date = startDate.toISOString().split('T')[0];
                  } catch (e) {}
              }

              if (!newContract.partner_id) {
                  if (!hasError) errors.push(`Row ${index + 2}: '파트너사명'이 비어있거나 유효하지 않습니다.`);
                  hasError = true;
              }
              if (!newContract.device_name) {
                  if (!hasError) errors.push(`Row ${index + 2}: '기기명'이 비어있습니다.`);
                  hasError = true;
              }
              if (!newContract.expiry_date) {
                  if (!hasError) errors.push(`Row ${index + 2}: '만료일'이 없습니다.`);
                  hasError = true;
              }

              if (!hasError) {
                  newContracts.push(newContract);
              }
          });
        }

        if (errors.length > 0) {
            throw new Error(errors.join('\n'));
        }

        await onImportContracts(newContracts);
        setImportStatus({ loading: false, message: `✅ ${newContracts.length}개의 계약을 성공적으로 등록했습니다.` });

    } catch (error: any) {
        console.error("Error importing contracts:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        setImportStatus({ loading: false, message: `❌ 오류가 발생했습니다:\n${errorMessage}` });
    } finally {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }
  };

  const groupedAndFilteredContracts = useMemo(() => {
    const groups: { [key: string]: { key: string; distributor_name: string; lessee_name: string; contracts: Contract[] } } = {};

    contracts.forEach(c => {
      const key = `${c.distributor_name || '총판 없음'}-${c.lessee_name || '계약자 없음'}`;
      if (!groups[key]) {
        groups[key] = {
          key,
          distributor_name: c.distributor_name || '총판 없음',
          lessee_name: c.lessee_name || '계약자 없음',
          contracts: [],
        };
      }
      groups[key].contracts.push(c);
    });

    const statusFilteredGroups = Object.values(groups)
      .map(group => {
        const filteredContracts = group.contracts.filter(c => statusFilter === 'all' || c.status === statusFilter);
        if (filteredContracts.length === 0) return null;
        return { ...group, contracts: filteredContracts };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);

    const searchFilteredGroups = statusFilteredGroups.filter(group => {
      const lowerSearchTerm = searchTerm.toLowerCase();
      const groupMatch =
        group.distributor_name.toLowerCase().includes(lowerSearchTerm) ||
        group.lessee_name.toLowerCase().includes(lowerSearchTerm);

      if (groupMatch) return true;

      return group.contracts.some(c =>
        c.device_name.toLowerCase().includes(lowerSearchTerm) ||
        String(c.contract_number).includes(searchTerm) ||
        (partnerMap.get(c.partner_id) || '').toLowerCase().includes(lowerSearchTerm)
      );
    });
    
    return searchFilteredGroups.map(group => {
        const totalUnits = group.contracts.reduce((sum, c) => sum + (c.units_required || 1), 0);
        const totalAmount = group.contracts.reduce((sum, c) => sum + c.total_amount, 0);
        const totalRemaining = group.contracts.reduce((sum, c) => {
          const totalPaid = (c.daily_deductions || [])
            .filter(d => d.status === DeductionStatus.PAID)
            .reduce((s, d) => s + d.amount, 0);
          return sum + (c.total_amount - totalPaid);
        }, 0);
  
        return {
          ...group,
          contractCount: group.contracts.length,
          totalUnits,
          totalAmount,
          totalRemaining,
        };
      });

  }, [contracts, searchTerm, statusFilter, partnerMap]);

  const handleToggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) newSet.delete(key);
      else newSet.add(key);
      return newSet;
    });
  };

  const toggleSelectForDelete = (id: string) => {
    setSelectedForDelete(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
      return newSet;
    });
  };

  const toggleSelectGroup = (contractIds: string[]) => {
    setSelectedForDelete(prev => {
      const newSet = new Set(prev);
      const allSelected = contractIds.every(id => newSet.has(id));
      contractIds.forEach(id => allSelected ? newSet.delete(id) : newSet.add(id));
      return newSet;
    });
  };

  const handleDeleteSelected = async () => {
    if (!onDeleteContracts || selectedForDelete.size === 0) return;
    if (!confirm(`선택한 ${selectedForDelete.size}건의 계약을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    try {
      await onDeleteContracts(Array.from(selectedForDelete));
      setSelectedForDelete(new Set());
    } catch (error: any) {
      alert(`삭제 실패: ${error.message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-white">계약 관리</h2>
        <div className="flex space-x-2">
            <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleFileImport} />
            <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importStatus.loading}
                className="flex items-center bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-md hover:shadow-lg disabled:opacity-50"
            >
                <UploadIcon className="w-5 h-5 mr-2" />
                {importStatus.loading ? '처리 중...' : '엑셀로 가져오기'}
            </button>
            <button
              onClick={() => onAddContract()}
              className="flex items-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg transition-colors shadow-md hover:shadow-lg"
            >
              <PlusIcon className="w-5 h-5 mr-2" />
              신규 계약 추가
            </button>
        </div>
      </div>

    {importStatus.message && (
        <div className={`p-4 rounded-lg mb-4 text-sm whitespace-pre-wrap ${importStatus.message.startsWith('❌') ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
            {importStatus.message}
        </div>
    )}

      {/* 삭제 바 */}
      {selectedForDelete.size > 0 && (
        <div className="flex items-center justify-between bg-red-900/30 border border-red-700/50 p-3 rounded-lg mb-4">
          <span className="text-red-300 text-sm font-medium">{selectedForDelete.size}건 선택됨</span>
          <div className="flex gap-2">
            <button onClick={() => setSelectedForDelete(new Set())} className="text-sm text-slate-400 hover:text-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-700">선택 해제</button>
            <button onClick={handleDeleteSelected} disabled={deleting}
              className="text-sm bg-red-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50">
              {deleting ? '삭제 중...' : `${selectedForDelete.size}건 삭제`}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center space-x-4 bg-slate-800 p-4 rounded-lg mb-6">
        <input
          type="text"
          placeholder="계약번호, 기기명, 파트너사, 총판명, 계약자명 검색..."
          className="bg-slate-700 text-white placeholder-slate-400 rounded-lg px-4 py-2 w-full md:w-2/5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select
          className="bg-slate-700 text-white rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ContractStatus | 'all')}
        >
          <option value="all">모든 상태</option>
          <option value={ContractStatus.ACTIVE}>진행중</option>
          <option value={ContractStatus.EXPIRED}>만료</option>
          <option value={ContractStatus.SETTLED}>정산완료</option>
        </select>
      </div>
      
      <details className="bg-slate-700/50 rounded-lg p-4 mb-6 text-sm text-slate-300">
        <summary className="cursor-pointer font-semibold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-sm">
          엑셀로 가져오기 양식 안내
        </summary>
        <div className="mt-4">
            <p>엑셀 파일의 첫 번째 행은 아래의 헤더(제목)와 정확히 일치해야 합니다. 순서는 상관 없으나, <span className="text-yellow-400">필수 항목</span>은 반드시 포함되어야 합니다.</p>
            <ul className="list-disc list-inside mt-2 space-y-1 md:columns-2">
                <li><span className="font-semibold text-yellow-400">'파트너사명' (필수)</span></li>
                <li><span className="font-semibold text-yellow-400">'기기명' (필수, 예: 아이폰 16 Pro)</span></li>
                <li><span className="font-semibold">'용량' (선택, 예: 256GB)</span></li>
                <li>'색상'</li>
                <li><span className="font-semibold text-yellow-400">'계약일' (필수, YYYY-MM-DD)</span></li>
                <li>'실행일' (YYYY-MM-DD)</li>
                <li>'만료일' (YYYY-MM-DD)</li>
                <li>'계약 기간' (숫자)</li>
                <li>'총 채권액' (숫자)</li>
                <li>'일차감액' 또는 '일 차감액' (숫자)</li>
                <li>'계약자(라이더)'</li>
                <li>'계약자 연락처'</li>
                <li>'계약자 사업자번호'</li>
                <li>'계약자 사업자주소'</li>
                <li>'총판명'</li>
                <li>'필요 수량' (숫자)</li>
                <li>'정산 차수' (숫자)</li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">
                ※ '파트너사명'은 시스템에 등록된 이름과 정확히 일치해야 합니다.<br/>
                ※ 날짜 데이터는 엑셀의 날짜 서식(예: 2024-01-01)으로 지정해야 올바르게 인식됩니다.
            </p>
        </div>
      </details>

      <div className="bg-slate-800 rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="p-4 w-12"></th>
                <th className="p-4 font-semibold text-slate-400">총판</th>
                <th className="p-4 font-semibold text-slate-400">계약자</th>
                <th className="p-4 font-semibold text-slate-400 text-center">계약 건수</th>
                <th className="p-4 font-semibold text-slate-400 text-center">총 신청수량</th>
                <th className="p-4 font-semibold text-slate-400">총 채권액</th>
                <th className="p-4 font-semibold text-slate-400">총 잔액</th>
                <th className="p-4 font-semibold text-slate-400 text-center">작업</th>
              </tr>
            </thead>
            <tbody>
              {groupedAndFilteredContracts.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-slate-400">일치하는 계약이 없습니다.</td></tr>
              )}
              {groupedAndFilteredContracts.map(group => {
                const isExpanded = expandedKeys.has(group.key);
                const firstContract = group.contracts[0];

                return (
                  <Fragment key={group.key}>
                    <tr onClick={() => handleToggleExpand(group.key)} className="border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer transition-colors">
                      <td className="p-4 text-center"><ChevronDownIcon className={`w-5 h-5 text-slate-400 transition-transform transform ${isExpanded ? 'rotate-180' : ''}`} /></td>
                      <td className="p-4 font-medium text-white">
                        {group.distributor_name}
                        {(() => {
                          const dr = computeDistributorRisk(contracts, group.distributor_name);
                          return dr ? <MiniRiskBadge level={classifyRisk(dr.rate, dr.lawsuitCount > 0)} /> : null;
                        })()}
                      </td>
                      <td className="p-4 font-medium text-white">{group.lessee_name}</td>
                      <td className="p-4 text-center">{group.contractCount}건</td>
                      <td className="p-4 text-center">{group.totalUnits}대</td>
                      <td className="p-4">{formatCurrency(group.totalAmount)}</td>
                      <td className="p-4 text-yellow-400 font-semibold">{formatCurrency(group.totalRemaining)}</td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const template: Partial<Contract> = {
                                distributor_name: firstContract.distributor_name,
                                distributor_contact: firstContract.distributor_contact,
                                distributor_business_number: firstContract.distributor_business_number,
                                distributor_address: firstContract.distributor_address,
                                lessee_name: firstContract.lessee_name,
                                lessee_contact: firstContract.lessee_contact,
                                lessee_business_number: firstContract.lessee_business_number,
                                lessee_business_address: firstContract.lessee_business_address,
                                partner_id: firstContract.partner_id,
                              };
                              onAddContract(template);
                            }}
                            title={`${group.lessee_name}님 계약 추가`}
                            className="p-2 rounded-full text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                          >
                              <DuplicateIcon className="w-5 h-5" />
                          </button>
                          <button
                            onClick={(e) => {
                               e.stopPropagation();
                               const template: Partial<Contract> = {};
                               if (firstContract.distributor_name !== '총판 없음') {
                                   template.distributor_name = firstContract.distributor_name;
                                   template.distributor_contact = firstContract.distributor_contact;
                                   template.distributor_business_number = firstContract.distributor_business_number;
                                   template.distributor_address = firstContract.distributor_address;
                               }
                               template.partner_id = firstContract.partner_id;
                               onAddContract(template);
                            }}
                            title={`${group.distributor_name}에 신규 계약자 추가`}
                            className="p-2 rounded-full text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                          >
                              <UserPlusIcon className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-900/50">
                        <td colSpan={8} className="p-0">
                          <div className="p-4">
                            <table className="w-full text-left bg-slate-800/70 rounded-md">
                              <thead className="bg-slate-700/50">
                                <tr>
                                  {onDeleteContracts && (
                                    <th className="p-3 w-10">
                                      <input type="checkbox"
                                        checked={group.contracts.every(c => selectedForDelete.has(c.id))}
                                        onChange={() => toggleSelectGroup(group.contracts.map(c => c.id))}
                                        className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-700 text-indigo-600" />
                                    </th>
                                  )}
                                  <th className="p-3 font-semibold text-slate-400">계약번호</th>
                                  <th className="p-3 font-semibold text-slate-400">기기명</th>
                                  <th className="p-3 font-semibold text-slate-400">파트너사</th>
                                  <th className="p-3 font-semibold text-slate-400">만료일</th>
                                  <th className="p-3 font-semibold text-slate-400">채권액</th>
                                  <th className="p-3 font-semibold text-slate-400">잔액</th>
                                  <th className="p-3 font-semibold text-slate-400 text-center">상태</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.contracts.map(contract => {
                                  const totalPaid = (contract.daily_deductions || [])
                                    .filter(d => d.status === DeductionStatus.PAID)
                                    .reduce((sum, d) => sum + d.amount, 0);
                                  const remaining = contract.total_amount - totalPaid;
                                  return (
                                    <tr key={contract.id} onClick={(e) => { e.stopPropagation(); onSelectContract(contract); }} className="border-b border-slate-700 last:border-b-0 hover:bg-slate-700/70 cursor-pointer transition-colors">
                                      {onDeleteContracts && (
                                        <td className="p-3 w-10" onClick={(e) => e.stopPropagation()}>
                                          <input type="checkbox"
                                            checked={selectedForDelete.has(contract.id)}
                                            onChange={() => toggleSelectForDelete(contract.id)}
                                            className="h-3.5 w-3.5 rounded border-slate-500 bg-slate-700 text-indigo-600" />
                                        </td>
                                      )}
                                      <td className="p-3 text-center font-mono text-indigo-400">#{contract.contract_number}</td>
                                      <td className="p-3 font-medium text-white">{contract.device_name}</td>
                                      <td className="p-3">{partnerMap.get(contract.partner_id)}</td>
                                      <td className="p-3">{formatDate(contract.expiry_date)}</td>
                                      <td className="p-3">{formatCurrency(contract.total_amount)}</td>
                                      <td className="p-3 text-yellow-400">{formatCurrency(remaining)}</td>
                                      <td className="p-3 text-center"><StatusBadge status={contract.status} /></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};