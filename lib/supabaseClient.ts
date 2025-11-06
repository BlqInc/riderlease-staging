import { createClient } from '@supabase/supabase-js'
import { Contract, Partner, CalendarEvent } from '../types';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

// FIX: Refactor Database types to be more explicit and correct to avoid 'never' type errors in App.tsx.
type Database = {
  public: {
    Tables: {
      contracts: {
        Row: Omit<Contract, 'unpaid_balance'>
        Insert: Omit<Contract, 'id' | 'unpaid_balance' | 'daily_deductions'>
        Update: Partial<Omit<Contract, 'id' | 'unpaid_balance' | 'contract_number'>>
      }
      partners: {
        Row: Partner
        Insert: Omit<Partner, 'id'>
        Update: Partial<Omit<Partner, 'id'>>
      }
      events: {
        Row: CalendarEvent
        Insert: Omit<CalendarEvent, 'id'>
        Update: Partial<Omit<CalendarEvent, 'id'>>
      }
    }
  }
}

export const isSupabaseConfigured = supabaseUrl && supabaseAnonKey;

export const supabase = isSupabaseConfigured ? createClient<Database>(supabaseUrl!, supabaseAnonKey!) : null;
