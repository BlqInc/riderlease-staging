

import React, { useState, useMemo, Fragment, useRef } from 'react';
import { Contract, ContractStatus, Partner, DeductionStatus, SettlementStatus, ShippingStatus, ProcurementStatus } from '../types';
import { formatDate, formatCurrency } from '../lib/utils';
import { PlusIcon, ChevronDownIcon, DuplicateIcon, UserPlusIcon, UploadIcon } from './icons/IconComponents';
import { read, utils } from 'xlsx';

interface ContractManagementProps {
  contracts: Contract[];
  partners: Partner[];
  onSelectContract: (contract: Contract) => void;
  onAddContract: (template?: Partial<Contract>) => void;
  onImportContracts: (contracts: Partial<Omit<Contract, 'id' | 'contract_number' | 'unpaid_balance'>>[]) => Promise<void>;
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

export const ContractManagement: React.FC<ContractManagementProps> = ({ contracts, partners, onSelectContract, onAddContract, onImportContracts }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [importStatus, setImportStatus] = useState({ loading: false, message: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const partnerMap = useMemo(() => new Map(partners.map(p => [p.id, p.name])), [partners]);

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportStatus({ loading: true, message: '파일을 분석 중입니다...' });

    try {
        const data = await file.arrayBuffer();
        const workbook = read(data);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData: Record<string, any>[] = utils.sheet_to_json(worksheet);

        if (!Array.isArray(jsonData)) {
          throw new Error("엑셀 파일의 형식이 올바르지 않습니다. 객체의 배열이어야 합니다.");
        }
        
        const partnerNameToIdMap = new Map(partners.map(p => [p.name.trim().toLowerCase(), p.id]));
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
        };

        const newContracts: Partial<Omit<Contract, 'id' | 'contract_number' | 'unpaid_balance'>>[] = [];
        const errors: string[] = [];

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
                        // FIX: Explicitly convert the value to a string, as it is read as 'unknown' from the Excel file.
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
                            errors.push(`Row ${index + 2}: '${header}'의 날짜 형식이 올바르지 않습니다. (YYYY-MM-DD 필요)`);
                            hasError = true;
                        }
                    } else if (['duration_days', 'total_amount', 'daily_deduction', 'units_required'].includes(field)) {
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

            if (!newContract.partner_id) {
                if (!hasError) errors.push(`Row ${index + 2}: '파트너사명'이 비어있거나 유효하지 않습니다.`);
                hasError = true;
            }
            if (!newContract.device_name) {
                errors.push(`Row ${index + 2}: '기기명'이 비어있습니다.`);
                hasError = true;
            }

            if (!hasError) {
                newContracts.push(newContract);
            }
        });

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
                      <td className="p-4 font-medium text-white">{group.distributor_name}</td>
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