
import React from 'react';
import { Contract, Partner, DeductionStatus } from '../types';
import { formatDate, formatCurrency, getDaysDifference } from '../lib/utils';
import { CloseIcon, EditIcon, TrashIcon, DuplicateIcon } from './icons/IconComponents';

interface ContractDetailModalProps {
  contract: Contract | null;
  partner: Partner | null;
  onClose: () => void;
  onEdit: (contract: Contract) => void;
  onDelete: (contractId: string) => void;
  onDuplicate: (contract: Contract) => void;
}

const DetailSection: React.FC<{ title: string, children: React.ReactNode }> = ({ title, children }) => (
    <div>
        <h3 className="text-xl font-bold text-white mb-4 border-b border-slate-700 pb-2">{title}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6">
            {children}
        </div>
    </div>
);

const DetailItem: React.FC<{ label: string; value: React.ReactNode; className?: string }> = ({ label, value, className }) => (
    <div className={`flex flex-col ${className}`}>
        <span className="text-sm text-slate-400">{label}</span>
        <span className="text-md font-semibold text-white">{value || 'N/A'}</span>
    </div>
);

const DeductionStatusBadge: React.FC<{ status: DeductionStatus }> = ({ status }) => {
  const baseClasses = "px-2 py-1 text-xs font-semibold rounded-full";
  const statusClasses = {
    [DeductionStatus.PAID]: "bg-green-500/20 text-green-300",
    [DeductionStatus.UNPAID]: "bg-red-500/20 text-red-300",
    [DeductionStatus.PENDING]: "bg-slate-500/20 text-slate-300",
    [DeductionStatus.PARTIAL]: "bg-yellow-500/20 text-yellow-300",
  };
  return <span className={`${baseClasses} ${statusClasses[status]}`}>{status}</span>;
};

export const ContractDetailModal: React.FC<ContractDetailModalProps> = ({ contract, partner, onClose, onEdit, onDelete, onDuplicate }) => {
  if (!contract || !partner) return null;

  const totalPaid = (contract.daily_deductions || [])
    .filter(d => d.status === DeductionStatus.PAID)
    .reduce((sum, d) => sum + d.amount, 0);

  const remainingAmount = contract.total_amount - totalPaid;
  const isOverdue = new Date(contract.expiry_date) < new Date() && contract.status !== '정산완료';
  const overdueDays = isOverdue ? getDaysDifference(contract.expiry_date, new Date().toISOString()) : 0;
  const overdueCharge = overdueDays * contract.daily_deduction;

  const handleDelete = () => {
    if (window.confirm(`[#${contract.contract_number}] '${contract.device_name}' 계약을 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
      onDelete(contract.id);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <header className="flex justify-between items-center p-6 border-b border-slate-700">
          <div>
            <h2 className="text-2xl font-bold text-white">[#<span className="text-indigo-400">{contract.contract_number}</span>] {contract.device_name}</h2>
            <p className="text-slate-400">{partner.name} / {contract.color}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 transition-colors">
            <CloseIcon className="w-6 h-6 text-slate-400" />
          </button>
        </header>
        
        <main className="p-8 overflow-y-auto space-y-8">
            <div className="bg-slate-900/50 p-6 rounded-lg grid grid-cols-2 md:grid-cols-5 gap-6">
                <DetailItem label="총 채권액" value={formatCurrency(contract.total_amount)} />
                <DetailItem label="총 납부액" value={<span className="text-green-400">{formatCurrency(totalPaid)}</span>} />
                <DetailItem label="미납액" value={<span className="text-red-400">{formatCurrency(contract.unpaid_balance)}</span>} />
                <DetailItem label="잔액" value={<span className="text-yellow-400">{formatCurrency(remainingAmount)}</span>} />
                <DetailItem label="상태" value={contract.status} />
            </div>

             {isOverdue && (
                <div className="bg-red-900/50 border border-red-700 text-red-300 p-4 rounded-lg">
                    <h4 className="font-bold">만료 후 추가 청구</h4>
                    <p>만료일로부터 {overdueDays}일 경과되었습니다. | 추가 청구액: {formatCurrency(overdueCharge)}</p>
                    <p className="font-bold mt-2">총 잔액 (추가분 포함): {formatCurrency(remainingAmount + overdueCharge)}</p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-8">
                    <DetailSection title="계약 정보">
                        <DetailItem label="계약일" value={formatDate(contract.contract_date)} />
                        <DetailItem label="실행일" value={contract.execution_date ? formatDate(contract.execution_date) : 'N/A'} />
                        <DetailItem label="만료일" value={formatDate(contract.expiry_date)} />
                        <DetailItem label="계약 기간" value={`${contract.duration_days}일`} />
                        <DetailItem label="일차감" value={formatCurrency(contract.daily_deduction)} />
                        <DetailItem label="첨부된 계약서" value={contract.contract_file_url ? <a href={contract.contract_file_url} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">파일 보기</a> : '없음'} />
                    </DetailSection>

                    <DetailSection title="조달 정보">
                        <DetailItem label="조달 상태" value={contract.procurement_status} />
                        <DetailItem label="확보/필요 수량" value={`${contract.units_secured || 0} / ${contract.units_required || 0}`} />
                        <DetailItem label="조달처" value={contract.procurement_source} />
                        <DetailItem label="조달 비용" value={contract.procurement_cost ? formatCurrency(contract.procurement_cost) : 'N/A'} />
                    </DetailSection>

                    <DetailSection title="배송 정보">
                        <DetailItem label="고객 배송 방법" value={contract.delivery_method_to_lessee} />
                        <DetailItem label="배송 상태" value={contract.shipping_status} />
                        <DetailItem label="배송일" value={contract.shipping_date ? formatDate(contract.shipping_date) : 'N/A'} />
                        <DetailItem label="배송 업체" value={contract.shipping_company} className="col-span-2"/>
                        <DetailItem label="운송장 번호" value={contract.tracking_number} className="col-span-2"/>
                    </DetailSection>
                    
                     <DetailSection title="정산 정보">
                        <DetailItem label="정산 상태" value={contract.settlement_status} />
                        <DetailItem label="고객 계약 완료" value={contract.is_lessee_contract_signed ? '완료' : '미완료'} />
                        <DetailItem label="정산 요청일" value={contract.settlement_request_date ? formatDate(contract.settlement_request_date) : 'N/A'} />
                        <DetailItem label="정산 완료일" value={contract.settlement_date ? formatDate(contract.settlement_date) : 'N/A'} />
                        <DetailItem label="정산차수" value={contract.settlement_round ? `${contract.settlement_round}차` : 'N/A'} />
                        <DetailItem label="담당자" value={contract.manager_name} />
                    </DetailSection>

                    <DetailSection title="총판 정보">
                        <DetailItem label="총판명" value={contract.distributor_name} />
                        <DetailItem label="연락처" value={contract.distributor_contact} />
                        <DetailItem label="사업자번호" value={contract.distributor_business_number} />
                        <DetailItem label="사업자주소" value={contract.distributor_address} className="col-span-2"/>
                    </DetailSection>

                    <DetailSection title="계약자 정보">
                        <DetailItem label="계약자(라이더)" value={contract.lessee_name} />
                        <DetailItem label="연락처" value={contract.lessee_contact} />
                        <DetailItem label="사업자번호" value={contract.lessee_business_number} />
                        <DetailItem label="사업자주소" value={contract.lessee_business_address} className="col-span-2"/>
                    </DetailSection>
                </div>
                 <div>
                    <h3 className="text-xl font-bold text-white mb-4">일일 차감 내역</h3>
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                        {(contract.daily_deductions || []).length > 0 ? [...(contract.daily_deductions || [])].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(d => (
                            <div key={d.id} className="bg-slate-700 p-3 rounded-lg flex justify-between items-center">
                                <div>
                                    <p className="font-semibold text-white">{formatDate(d.date)}</p>
                                    <p className="text-sm font-semibold">{formatCurrency(d.amount)}</p>
                                </div>
                                <DeductionStatusBadge status={d.status} />
                            </div>
                        )) : <p className="text-slate-400 text-center py-4">일차감 내역이 없습니다.</p>}
                    </div>
                </div>
            </div>
        </main>
        
        <footer className="p-6 mt-auto border-t border-slate-700 bg-slate-800/50 flex justify-between items-center">
            <button onClick={handleDelete} className="flex items-center bg-red-600/80 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                <TrashIcon className="w-5 h-5 mr-2" />
                삭제
            </button>
            <div className="flex space-x-4">
                <button onClick={() => onDuplicate(contract)} className="flex items-center bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                    <DuplicateIcon className="w-5 h-5 mr-2" />
                    복제
                </button>
                <button onClick={() => onEdit(contract)} className="flex items-center bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                    <EditIcon className="w-5 h-5 mr-2" />
                    수정
                </button>
                <button onClick={onClose} className="bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                    닫기
                </button>
            </div>
        </footer>
      </div>
    </div>
  );
};
