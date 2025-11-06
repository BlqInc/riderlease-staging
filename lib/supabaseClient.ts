
import { createClient } from '@supabase/supabase-js'
import { Contract, Partner, CalendarEvent, PriceTier, DailyDeductionLog, ContractStatus, ShippingStatus, ProcurementStatus, SettlementStatus } from '../types';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

// FIX: Refactor Database types to be more explicit and correct to avoid 'never' type errors in App.tsx.
// The `never` type errors are caused by a mismatch between TypeScript types (`| undefined` for optional)
// and the actual database structure (`| null` for empty fields). Explicit Row types are defined here to fix this.
interface ContractRow {
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

interface PartnerRow {
  id: string;
  name: string;
  business_number: string | null;
  address: string | null;
  price_list: PriceTier[] | null;
  is_template: boolean | null;
}

// FIX: Added CalendarEventRow to correctly type database rows with null for optional fields, resolving 'never' type errors.
interface CalendarEventRow {
  id: string;
  title: string;
  date: string;
  user: string;
  color: string;
  end_date: string | null;
  time: string | null;
}

type Database = {
  public: {
    Tables: {
      contracts: {
        Row: ContractRow
        Insert: Partial<ContractRow>
        Update: Partial<Omit<ContractRow, 'id' | 'contract_number'>>
      }
      partners: {
        Row: PartnerRow
        Insert: Partial<PartnerRow>
        Update: Partial<Omit<PartnerRow, 'id'>>
      }
      events: {
        // FIX: Using CalendarEventRow instead of CalendarEvent resolves the type mismatch (undefined vs null) and fixes the 'never' type errors.
        Row: CalendarEventRow
        Insert: Partial<CalendarEventRow>
        Update: Partial<Omit<CalendarEventRow, 'id'>>
      }
    }
  }
}

export const isSupabaseConfigured = supabaseUrl && supabaseAnonKey;

export const supabase = isSupabaseConfigured ? createClient<Database>(supabaseUrl!, supabaseAnonKey!) : null;
