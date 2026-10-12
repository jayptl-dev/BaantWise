export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      expense_shares: {
        Row: {
          expense_id: string
          member_id: string
          share_cents: number
        }
        Insert: {
          expense_id: string
          member_id: string
          share_cents: number
        }
        Update: {
          expense_id?: string
          member_id?: string
          share_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_shares_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_shares_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_cents: number
          category: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          fx_rate: number | null
          fx_rate_date: string | null
          group_id: string
          id: string
          original_amount_cents: number | null
          original_currency: string | null
          paid_by: string
          receipt_path: string | null
          recurring_id: string | null
          spent_on: string
          split_method: string
          split_snapshot: Json | null
          updated_at: string
          visibility: string
        }
        Insert: {
          amount_cents: number
          category?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
          fx_rate?: number | null
          fx_rate_date?: string | null
          group_id: string
          id?: string
          original_amount_cents?: number | null
          original_currency?: string | null
          paid_by: string
          receipt_path?: string | null
          recurring_id?: string | null
          spent_on?: string
          split_method?: string
          split_snapshot?: Json | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          amount_cents?: number
          category?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          fx_rate?: number | null
          fx_rate_date?: string | null
          group_id?: string
          id?: string
          original_amount_cents?: number | null
          original_currency?: string | null
          paid_by?: string
          receipt_path?: string | null
          recurring_id?: string | null
          spent_on?: string
          split_method?: string
          split_snapshot?: Json | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_group_id_paid_by_fkey"
            columns: ["group_id", "paid_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "id"]
          },          {
            foreignKeyName: "expenses_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string
          display_name: string
          group_id: string
          id: string
          is_admin: boolean
          removed_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          group_id: string
          id?: string
          is_admin?: boolean
          removed_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          group_id?: string
          id?: string
          is_admin?: boolean
          removed_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      forwarded_bills: {
        Row: {
          amount_cents: number | null
          bill_date: string | null
          biller: string | null
          category: string
          closed_at: string | null
          created_at: string
          currency: string
          expense_id: string | null
          group_id: string
          id: string
          message_key: string
          status: string
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          bill_date?: string | null
          biller?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          currency?: string
          expense_id?: string | null
          group_id: string
          id?: string
          message_key: string
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          bill_date?: string | null
          biller?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          currency?: string
          expense_id?: string | null
          group_id?: string
          id?: string
          message_key?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forwarded_bills_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forwarded_bills_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          default_split: Json | null
          forward_token: string
          id: string
          invite_token: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          default_split?: Json | null
          forward_token: string
          id?: string
          invite_token?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          default_split?: Json | null
          forward_token?: string
          id?: string
          invite_token?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          interac_contact: string | null
          paypal_me: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          interac_contact?: string | null
          paypal_me?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          interac_contact?: string | null
          paypal_me?: string | null
        }
        Relationships: []
      }
      recurring_bills: {
        Row: {
          closed_at: string | null
          created_at: string
          due_on: string
          expense_id: string | null
          group_id: string
          id: string
          recurring_id: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          due_on: string
          expense_id?: string | null
          group_id: string
          id?: string
          recurring_id: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          due_on?: string
          expense_id?: string | null
          group_id?: string
          id?: string
          recurring_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_bills_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_bills_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_bills_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expenses: {
        Row: {
          amount_cents: number | null
          amount_kind: string
          category: string
          created_at: string
          created_by: string
          description: string
          end_on: string | null
          frequency: string
          group_id: string
          id: string
          next_index: number
          next_on: string | null
          paid_by: string
          paused: boolean
          split: Json
          start_on: string
          updated_at: string
          visibility: string
        }
        Insert: {
          amount_cents?: number | null
          amount_kind: string
          category?: string
          created_at?: string
          created_by?: string
          description: string
          end_on?: string | null
          frequency: string
          group_id: string
          id?: string
          next_index?: number
          next_on?: string | null
          paid_by: string
          paused?: boolean
          split: Json
          start_on: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          amount_cents?: number | null
          amount_kind?: string
          category?: string
          created_at?: string
          created_by?: string
          description?: string
          end_on?: string | null
          frequency?: string
          group_id?: string
          id?: string
          next_index?: number
          next_on?: string | null
          paid_by?: string
          paused?: boolean
          split?: Json
          start_on?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_group_id_paid_by_fkey"
            columns: ["group_id", "paid_by"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          from_member: string
          group_id: string
          id: string
          note: string | null
          paid_on: string
          to_member: string
          visibility: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          from_member: string
          group_id: string
          id?: string
          note?: string | null
          paid_on?: string
          to_member: string
          visibility?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          from_member?: string
          group_id?: string
          id?: string
          note?: string | null
          paid_on?: string
          to_member?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_group_id_from_member_fkey"
            columns: ["group_id", "from_member"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "id"]
          },
          {
            foreignKeyName: "settlements_group_id_to_member_fkey"
            columns: ["group_id", "to_member"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_forwarding_setup: {
        Args: { p_group_id: string }
        Returns: {
          allowed: boolean
          forward_token: string
          group_name: string
        }[]
      }
      claim_receipt_scan: {
        Args: never
        Returns: {
          allowed: boolean
          resets_on: string
          scans_limit: number
          scans_used: number
        }[]
      }
      complete_recurring_bill: {
        Args: { p_bill_id: string; p_expense_id: string }
        Returns: undefined
      }
      create_group: { Args: { p_name: string }; Returns: string }
      delete_expense: { Args: { p_expense_id: string }; Returns: undefined }
      delete_settlement: {
        Args: { p_settlement_id: string }
        Returns: undefined
      }
      get_invite: {
        Args: { p_token: string }
        Returns: {
          already_member: boolean
          group_id: string
          group_name: string
          member_count: number
        }[]
      }
      inbound_add_bill: {
        Args: {
          p_amount_cents: number
          p_bill_date: string
          p_biller: string
          p_category: string
          p_currency: string
          p_group_id: string
          p_message_key: string
          p_user_id: string
        }
        Returns: string
      }
      inbound_match: {
        Args: { p_emails: string[]; p_token: string }
        Returns: {
          bills_today: number
          email: string
          group_id: string
          group_name: string
          member_name: string
          user_id: string
        }[]
      }
      join_group: { Args: { p_token: string }; Returns: string }
      leave_group: { Args: { p_group_id: string }; Returns: undefined }
      prepare_account_deletion: { Args: never; Returns: undefined }
      remove_member: { Args: { p_member_id: string }; Returns: undefined }
      reset_forward_address: { Args: { p_group_id: string }; Returns: string }
      reset_invite_link: { Args: { p_group_id: string }; Returns: string }
      resolve_forwarded_bill: {
        Args: { p_bill_id: string; p_expense_id: string }
        Returns: undefined
      }
      save_expense: {
        Args: {
          p_amount_cents: number
          p_category?: string
          p_description: string
          p_expense_id?: string
          p_fx_rate?: number
          p_fx_rate_date?: string
          p_group_id: string
          p_original_amount_cents?: number
          p_original_currency?: string
          p_paid_by: string
          p_shares: Json
          p_spent_on?: string
          p_split?: Json
          p_visibility?: string
        }
        Returns: string
      }
      save_recurring: {
        Args: {
          p_amount_cents: number
          p_amount_kind: string
          p_category: string
          p_description: string
          p_end_on: string
          p_frequency: string
          p_group_id: string
          p_id?: string
          p_paid_by: string
          p_split: Json
          p_start_on: string
          p_visibility: string
        }
        Returns: string
      }
      set_expense_receipt: {
        Args: { p_expense_id: string; p_path: string }
        Returns: undefined
      }
      set_member_admin: {
        Args: { p_make_admin: boolean; p_member_id: string }
        Returns: undefined
      }
      skip_recurring_bill: { Args: { p_bill_id: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
