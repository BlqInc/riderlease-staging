import { createClient } from '@supabase/supabase-js'
import { Contract, Partner, CalendarEvent } from '../types';

// Vite environment variables are exposed to the client-side code
// if they are prefixed with `VITE_`.
// Ensure your Vercel environment variables are named accordingly.
// FIX: (Line 7, 8) Cast `import.meta` to `any` to access Vite environment variables without TypeScript errors.
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

type Database = {
  public: {
    Tables: {
      contracts: {
        Row: Contract
        Insert: Omit<Contract, 'id' | 'dailyDeductions' | 'unpaidBalance'>
        Update: Partial<Omit<Contract, 'id' | 'contractNumber' | 'unpaidBalance'>>
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

// Initialize the client only if the configuration is provided
export const supabase = isSupabaseConfigured ? createClient<Database>(supabaseUrl!, supabaseAnonKey!) : null;