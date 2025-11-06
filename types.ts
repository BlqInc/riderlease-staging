
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
  business_number: string | null;
  address: string | null;
  price_list: PriceTier[] | null;
  is_template: boolean | null;
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
  contract_file_url: string | null;
  
  settlement_round: number | null;
  execution_date: string | null;
  shipping_date: string | null;
  shipping_company: string | null;
  tracking_number: string | null;
  shipping_status: ShippingStatus | null;
  settlement_date: string | null;
  manager_name: string | null;
  lessee_name: string | null;
  lessee_contact: string | null;
  lessee_business_number: string | null;
  lessee_business_address: string | null;

  distributor_name: string | null;
  distributor_contact: string | null;
  distributor_business_number: string | null;
  distributor_address: string | null;

  procurement_status: ProcurementStatus | null;
  procurement_source: string | null;
  procurement_cost: number | null;
  units_required: number | null;
  units_secured: number | null;
  delivery_method_to_lessee: string | null;

  settlement_status: SettlementStatus;
  is_lessee_contract_signed: boolean;
  settlement_request_date: string | null;
  settlement_document_url: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  user: string;
  color: string;
  end_date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
}