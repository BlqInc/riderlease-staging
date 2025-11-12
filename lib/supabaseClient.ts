

import { createClient } from '@supabase/supabase-js'
import { Contract, Partner, CalendarEvent, DailyDeductionLog, PriceTier, GreenwichSettlement } from '../types';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

// These types represent the actual shape of the data in the database tables.
// All optional fields are explicitly typed as `| null` to match the database schema.
// FIX: Explicitly type jsonb columns as `any` to prevent Supabase client from inferring `never`.
type ContractRow = Omit<Contract, 'unpaid_balance' | 'daily_deductions'> & { daily_deductions: any };
type PartnerRow = Omit<Partner, 'price_list'> & { price_list: any };
type CalendarEventRow = CalendarEvent;
type GreenwichSettlementRow = GreenwichSettlement;

// Define the database schema for the Supabase client, using the correct Row types.
// This ensures that all select, insert, and update operations are type-safe and
// align with the actual database structure, preventing 'never' type errors.
export type Database = {
  public: {
    Tables: {
      contracts: {
        Row: ContractRow
        Insert: Omit<ContractRow, 'id'>
        // FIX: The Supabase client's `update` method expects a partial object. Defining
        // the Update type as Partial here resolves the type inference conflicts.
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
      greenwich_settlements: {
        Row: GreenwichSettlementRow
        Insert: Omit<GreenwichSettlementRow, 'id' | 'created_at'>
        Update: Partial<Omit<GreenwichSettlementRow, 'id' | 'created_at'>>
      }
    }
    // FIX: Add empty Enums and Functions properties to the schema for better type stability.
    Enums: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
  }
}

export const isSupabaseConfigured = supabaseUrl && supabaseAnonKey;

export const supabase = isSupabaseConfigured ? createClient<Database>(supabaseUrl!, supabaseAnonKey!) : null;