
export enum ContractStatus {
  ACTIVE = '진행중',
  EXPIRED = '만료',
  SETTLED = '정산완료',
}

export enum ShippingStatus {
  PREPARING = '물품 준비중',
  SHIPPED = '배송중',
  DELIVERED = '배송완료',
}

export enum ProcurementStatus {
  SECURED = '확보완료',
  UNSECURED = '미확보',
}

export enum DeductionStatus {
  PAID = '납부완료',
  UNPAID = '미납',
  PENDING = '확인대기',
  PARTIAL = '부분납부',
}

export enum SettlementStatus {
  NOT_READY = '준비중',
  READY = '정산 가능',
  REQUESTED = '정산 요청됨',
  COMPLETED = '정산 완료',
}

export interface DailyDeductionLog {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  status: DeductionStatus;
  paidAmount: number;
}

export interface PriceTier {
  id: string;
  model: string;
  storage: string;
  durationDays: number;
  totalAmount: number;
  dailyDeduction: number;
}

export interface Partner {
  id: string;
  name: string;
  business_number?: string;
  address?: string;
  priceList?: PriceTier[];
  isTemplate?: boolean;
}

export interface Contract {
  id: string;
  contract_number: number; // 계약 고유 번호
  partnerId: string;
  deviceName: string;
  color: string;
  contractDate: string;
  expiryDate: string;
  durationDays: number;
  totalAmount: number;
  dailyDeduction: number;
  dailyDeductions: DailyDeductionLog[];
  unpaidBalance: number;
  status: ContractStatus;
  contractFileUrl?: string;
  
  // Detailed fields from Excel
  settlementRound?: number;
  executionDate?: string;
  shippingDate?: string;
  shippingCompany?: string;
  trackingNumber?: string;
  shippingStatus?: ShippingStatus;
  settlementDate?: string;
  managerName?: string; // 우리 담당자
  lesseeName?: string; // 계약자(라이더)
  lesseeContact?: string;
  lesseeBusinessNumber?: string;
  lesseeBusinessAddress?: string;

  // Distributor fields
  distributorName?: string; // 총판 이름
  distributorContact?: string; // 총판 연락처
  distributorBusinessNumber?: string; // 총판 사업자번호
  distributorAddress?: string; // 총판 주소

  // Procurement and delivery to lessee fields
  procurementStatus?: ProcurementStatus;
  procurementSource?: string; // 조달처
  procurementCost?: number;   // 조달 비용
  unitsRequired?: number;     // 필요 수량
  unitsSecured?: number;      // 확보 수량
  deliveryMethodToLessee?: string; // 고객 배송 방법 (퀵, 택배 등)

  // Settlement workflow fields
  settlementStatus: SettlementStatus;
  isLesseeContractSigned: boolean;
  settlementRequestDate?: string;
  settlementDocumentUrl?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  user: string;
  color: string;
}
