

import { createClient } from '@supabase/supabase-js'
import { Contract, Partner, CalendarEvent, DailyDeductionLog, PriceTier } from '../types';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

// These types represent the actual shape of the data in the database tables.
// All optional fields are explicitly typed as `| null` to match the database schema.
type ContractRow = Omit<Contract, 'unpaid_balance' | 'daily_deductions'> & {
  daily_deductions: DailyDeductionLog[] | null;
};
type PartnerRow = Partner;
type CalendarEventRow = CalendarEvent;

// Define the database schema for the Supabase client, using the correct Row types.
// This ensures that all select, insert, and update operations are type-safe and
// align with the actual database structure, preventing 'never' type errors.
type Database = {
  public: {
    Tables: {
      contracts: {
        Row: ContractRow
        // FIX: The optional daily_deductions property should also allow null.
        Insert: Omit<ContractRow, 'id' | 'daily_deductions'> & { daily_deductions?: DailyDeductionLog[] | null }
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