import { createClient } from '@supabase/supabase-js'
import { Contract, Partner, CalendarEvent, GreenwichSettlement } from '../types';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

type ContractRow = Omit<Contract, 'unpaid_balance' | 'daily_deductions'> & { daily_deductions: any };
type PartnerRow = Omit<Partner, 'price_list'> & { price_list: any };

export type Database = {
  public: {
    Tables: {
      contracts: {
        Row: ContractRow
        Insert: any
        Update: any
      }
      partners: {
        Row: PartnerRow
        Insert: any
        Update: any
      }
      events: {
        Row: CalendarEvent
        Insert: any
        Update: any
      }
      greenwich_settlements: {
        Row: GreenwichSettlement
        Insert: any
        Update: any
      }
    }
    Enums: { [_ in never]: never }
    Functions: { [_ in never]: never }
  }
}

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured ? createClient<Database>(supabaseUrl!, supabaseAnonKey!) : null;