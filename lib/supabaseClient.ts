
import { createClient } from '@supabase/supabase-js'
import { Contract, Partner, CalendarEvent } from '../types';

// Vite projects use `import.meta.env` to access environment variables.
// VITE_ is the required prefix for them to be exposed to the client-side code.
// FIX: Safely access env properties with optional chaining to prevent crashes when env is not defined.
const env = (import.meta as any)?.env;
const supabaseUrl = env?.VITE_SUPABASE_URL;
const supabaseAnonKey = env?.VITE_SUPABASE_ANON_KEY;

type Database = {
  public: {
    Tables: {
      contracts: {
        Row: Contract
        Insert: Omit<Contract, 'id' | 'dailyDeductions' | 'unpaidBalance'>
        Update: Partial<Omit<Contract, 'id' | 'contractNumber' | 'dailyDeductions' | 'unpaidBalance'>>
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

export const supabase = isSupabaseConfigured ? createClient<Database>(supabaseUrl, supabaseAnonKey) : null;