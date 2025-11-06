
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
  paid_amount: number;
}

export interface PriceTier {
  id: string;
  model: string;
  storage: string;
  duration_days: number;
  total_amount: number;
  daily_deduction: number;
}

export interface Partner {
  id: string;
  name: string;
  business_number?: string;
  address?: string;
  price_list?: PriceTier[];
  is_template?: boolean;
}

export interface Contract {
  id: string;
  contract_number: number;
  partner_id: string;
  device_name: string;
  color: string;
  contract_date: string;
  expiry_date: string;
  duration_days: number;
  total_amount: number;
  daily_deduction: number;
  daily_deductions: DailyDeductionLog[];
  unpaid_balance: number; // Client-side calculated
  status: ContractStatus;
  contract_file_url?: string;
  
  settlement_round?: number;
  execution_date?: string;
  shipping_date?: string;
  shipping_company?: string;
  tracking_number?: string;
  shipping_status?: ShippingStatus;
  settlement_date?: string;
  manager_name?: string;
  lessee_name?: string;
  lessee_contact?: string;
  lessee_business_number?: string;
  lessee_business_address?: string;

  distributor_name?: string;
  distributor_contact?: string;
  distributor_business_number?: string;
  distributor_address?: string;

  procurement_status?: ProcurementStatus;
  procurement_source?: string;
  procurement_cost?: number;
  units_required?: number;
  units_secured?: number;
  delivery_method_to_lessee?: string;

  settlement_status: SettlementStatus;
  is_lessee_contract_signed: boolean;
  settlement_request_date?: string;
  settlement_document_url?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  user: string;
  color: string;
}
