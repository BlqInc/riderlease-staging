

import { createClient } from '@supabase/supabase-js'
import { Contract, Partner, CalendarEvent, DailyDeductionLog } from '../types';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

// Directly use the application types which now correctly use | null for optional fields.
// This ensures perfect alignment between the app's data model and the database schema.
// FIX: The original ContractRow incorrectly assumed daily_deductions is always present.
// The application logic (e.g., `|| []`) suggests it can be null from the database.
// This change correctly types the database row, which fixes cascading type errors.
type ContractRow = Omit<Contract, 'unpaid_balance' | 'daily_deductions'> & {
  daily_deductions: DailyDeductionLog[] | null;
};
type PartnerRow = Partner;
type CalendarEventRow = CalendarEvent;

type Database = {
  public: {
    Tables: {
      contracts: {
        Row: ContractRow
        // FIX: daily_deductions is optional on insert, as it's client-calculated later.
        Insert: Omit<ContractRow, 'id' | 'daily_deductions'> & { daily_deductions?: DailyDeductionLog[] }
        Update: Partial<Omit<ContractRow, 'id' | 'contract_number'>>
      }
      partners: {
        Row: PartnerRow
        Insert: Omit<PartnerRow, 'id'>
        Update: Partial<Omit<PartnerRow, 'id'>>
      }
      events: {
        Row: CalendarEventRow
        Insert: Omit<CalendarEventRow, 'id'>
        Update: Partial<Omit<CalendarEventRow, 'id'>>
      }
    }
  }
}

export const isSupabaseConfigured = supabaseUrl && supabaseAnonKey;

export const supabase = isSupabaseConfigured ? createClient<Database>(supabaseUrl!, supabaseAnonKey!) : null;