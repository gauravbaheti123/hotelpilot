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
      activity_log: {
        Row: {
          action_type: string
          created_at: string
          details: Json
          id: string
          module: string
          property_id: string | null
          reference_id: string | null
          reference_label: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          details?: Json
          id?: string
          module: string
          property_id?: string | null
          reference_id?: string | null
          reference_label?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          details?: Json
          id?: string
          module?: string
          property_id?: string | null
          reference_id?: string | null
          reference_label?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          attendance_date: string
          check_in: string | null
          check_out: string | null
          created_at: string
          hours_worked: number
          id: string
          marked_by: string | null
          notes: string | null
          property_id: string
          staff_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attendance_date?: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          hours_worked?: number
          id?: string
          marked_by?: string | null
          notes?: string | null
          property_id: string
          staff_id: string
          status: string
          updated_at?: string
        }
        Update: {
          attendance_date?: string
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          hours_worked?: number
          id?: string
          marked_by?: string | null
          notes?: string | null
          property_id?: string
          staff_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_audit_log: {
        Row: {
          created_at: string
          email: string | null
          event_type: string
          id: string
          ip: string | null
          metadata: Json
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          event_type: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          event_type?: string
          id?: string
          ip?: string | null
          metadata?: Json
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      auth_lockouts: {
        Row: {
          email: string
          failed_count: number
          last_failure_at: string | null
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          email: string
          failed_count?: number
          last_failure_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          email?: string
          failed_count?: number
          last_failure_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      auth_login_attempts: {
        Row: {
          attempted_at: string
          email: string
          id: string
          ip: string | null
          reason: string | null
          success: boolean
          user_agent: string | null
        }
        Insert: {
          attempted_at?: string
          email: string
          id?: string
          ip?: string | null
          reason?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Update: {
          attempted_at?: string
          email?: string
          id?: string
          ip?: string | null
          reason?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      banquet_extra_charges: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          created_by: string | null
          discount_amount: number | null
          discount_type: string | null
          discount_value: number | null
          id: string
          point_name: string
          property_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          amount?: number
          booking_id: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          point_name: string
          property_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          point_name?: string
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "banquet_extra_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "banquet_extra_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banquet_extra_charges_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      banquet_master_bill_items: {
        Row: {
          booking_id: string
          created_at: string
          food_amount: number
          food_bill_number: string | null
          gst_amount: number
          id: string
          master_bill_id: string
          room_category: string | null
          room_number: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          food_amount?: number
          food_bill_number?: string | null
          gst_amount?: number
          id?: string
          master_bill_id: string
          room_category?: string | null
          room_number: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          food_amount?: number
          food_bill_number?: string | null
          gst_amount?: number
          id?: string
          master_bill_id?: string
          room_category?: string | null
          room_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "banquet_master_bill_items_master_bill_id_fkey"
            columns: ["master_bill_id"]
            isOneToOne: false
            referencedRelation: "banquet_master_bills"
            referencedColumns: ["id"]
          },
        ]
      }
      banquet_master_bills: {
        Row: {
          bill_number: string
          booking_id: string
          created_at: string
          food_subtotal: number
          gst_amount: number
          id: string
          property_id: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          bill_number: string
          booking_id: string
          created_at?: string
          food_subtotal?: number
          gst_amount?: number
          id?: string
          property_id: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          bill_number?: string
          booking_id?: string
          created_at?: string
          food_subtotal?: number
          gst_amount?: number
          id?: string
          property_id?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "banquet_master_bills_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "banquet_master_bills_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_sequences: {
        Row: {
          created_at: string
          id: string
          last_number: number
          prefix: string
          property_id: string
          sequence_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_number?: number
          prefix: string
          property_id: string
          sequence_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_number?: number
          prefix?: string
          property_id?: string
          sequence_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_sequences_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_companies: {
        Row: {
          address: string | null
          city: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          gst_status: string | null
          gstin: string | null
          id: string
          is_active: boolean
          name: string
          nation: string
          phone: string | null
          property_id: string
          state: string | null
          state_code: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          gst_status?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name: string
          nation?: string
          phone?: string | null
          property_id: string
          state?: string | null
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          gst_status?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          name?: string
          nation?: string
          phone?: string | null
          property_id?: string
          state?: string | null
          state_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_companies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_extra_beds: {
        Row: {
          added_by: string | null
          added_from_date: string
          booking_id: string
          created_at: string
          id: string
          is_wiped: boolean
          property_id: string
          quantity: number
          rate_per_night: number
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          added_from_date: string
          booking_id: string
          created_at?: string
          id?: string
          is_wiped?: boolean
          property_id: string
          quantity?: number
          rate_per_night: number
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          added_from_date?: string
          booking_id?: string
          created_at?: string
          id?: string
          is_wiped?: boolean
          property_id?: string
          quantity?: number
          rate_per_night?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_extra_beds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_extra_beds_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_extra_beds_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_guests: {
        Row: {
          age: number | null
          booking_id: string
          created_at: string
          guest_id: string
          id: string
          is_primary: boolean
          property_id: string
          relation_to_primary: string | null
          updated_at: string
        }
        Insert: {
          age?: number | null
          booking_id: string
          created_at?: string
          guest_id: string
          id?: string
          is_primary?: boolean
          property_id: string
          relation_to_primary?: string | null
          updated_at?: string
        }
        Update: {
          age?: number | null
          booking_id?: string
          created_at?: string
          guest_id?: string
          id?: string
          is_primary?: boolean
          property_id?: string
          relation_to_primary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_guests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_guests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_guests_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_guests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_rooms: {
        Row: {
          actual_check_in: string | null
          actual_check_out: string | null
          adults: number
          booking_id: string
          category_id: string | null
          check_in: string
          check_in_time: string | null
          check_out: string
          check_out_time: string | null
          children: number
          created_at: string
          end_date: string | null
          event_block_id: string | null
          event_booking_id: string | null
          extra_beds: number
          id: string
          meal_plan: Database["public"]["Enums"]["meal_plan"]
          property_id: string
          rate: number
          room_id: string | null
          shifted_at: string | null
          shifted_by: string | null
          shifted_to_room_id: string | null
          start_date: string
          status: string
          tariff_id: string | null
          updated_at: string
        }
        Insert: {
          actual_check_in?: string | null
          actual_check_out?: string | null
          adults?: number
          booking_id: string
          category_id?: string | null
          check_in: string
          check_in_time?: string | null
          check_out: string
          check_out_time?: string | null
          children?: number
          created_at?: string
          end_date?: string | null
          event_block_id?: string | null
          event_booking_id?: string | null
          extra_beds?: number
          id?: string
          meal_plan?: Database["public"]["Enums"]["meal_plan"]
          property_id: string
          rate?: number
          room_id?: string | null
          shifted_at?: string | null
          shifted_by?: string | null
          shifted_to_room_id?: string | null
          start_date?: string
          status?: string
          tariff_id?: string | null
          updated_at?: string
        }
        Update: {
          actual_check_in?: string | null
          actual_check_out?: string | null
          adults?: number
          booking_id?: string
          category_id?: string | null
          check_in?: string
          check_in_time?: string | null
          check_out?: string
          check_out_time?: string | null
          children?: number
          created_at?: string
          end_date?: string | null
          event_block_id?: string | null
          event_booking_id?: string | null
          extra_beds?: number
          id?: string
          meal_plan?: Database["public"]["Enums"]["meal_plan"]
          property_id?: string
          rate?: number
          room_id?: string | null
          shifted_at?: string | null
          shifted_by?: string | null
          shifted_to_room_id?: string | null
          start_date?: string
          status?: string
          tariff_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_rooms_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_rooms_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "room_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_event_block_id_fkey"
            columns: ["event_block_id"]
            isOneToOne: false
            referencedRelation: "event_room_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "booking_rooms_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_shifted_to_room_id_fkey"
            columns: ["shifted_to_room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariff_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          adults: number
          advance_amount: number
          advance_payment_mode: string | null
          balance_amount: number
          banquet_number: string | null
          bill_type: string | null
          billing_company_id: string | null
          booking_number: string
          booking_type: string
          cancelled_at: string | null
          cancelled_reason: string | null
          check_in: string
          check_out: string
          checked_in_at: string | null
          checked_in_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          children: number
          created_at: string
          created_by: string | null
          custom_remark: string | null
          discount_amount: number | null
          discount_type: string | null
          discount_value: number | null
          end_time: string | null
          event_date: string | null
          event_end_date: string | null
          event_id: string | null
          event_name: string | null
          event_status: string | null
          extra_charge: number | null
          extra_charge_description: string | null
          fb_charge: number | null
          function_type: string | null
          guest_id: string | null
          hall_charge: number | null
          hall_id: string | null
          host_email: string | null
          host_mobile: string | null
          host_name: string | null
          id: string
          is_wiped: boolean
          line_discounts: Json | null
          notes: string | null
          ota_partner_name: string | null
          package_rate: number | null
          pax: number | null
          payment_ref: string | null
          property_id: string
          rate_type: string
          restaurant_ledger_balance: number
          round_off_amount: number | null
          source: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          total_room_charges: number
          updated_at: string
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          adults?: number
          advance_amount?: number
          advance_payment_mode?: string | null
          balance_amount?: number
          banquet_number?: string | null
          bill_type?: string | null
          billing_company_id?: string | null
          booking_number: string
          booking_type?: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          check_in: string
          check_out: string
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          children?: number
          created_at?: string
          created_by?: string | null
          custom_remark?: string | null
          discount_amount?: number | null
          discount_type?: string | null
          discount_value?: number | null
          end_time?: string | null
          event_date?: string | null
          event_end_date?: string | null
          event_id?: string | null
          event_name?: string | null
          event_status?: string | null
          extra_charge?: number | null
          extra_charge_description?: string | null
          fb_charge?: number | null
          function_type?: string | null
          guest_id?: string | null
          hall_charge?: number | null
          hall_id?: string | null
          host_email?: string | null
          host_mobile?: string | null
          host_name?: string | null
          id?: string
          is_wiped?: boolean
          line_discounts?: Json | null
          notes?: string | null
          ota_partner_name?: string | null
          package_rate?: number | null
          pax?: number | null
          payment_ref?: string | null
          property_id: string
          rate_type?: string
          restaurant_ledger_balance?: number
          round_off_amount?: number | null
          source?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          total_room_charges?: number
          updated_at?: string
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          adults?: number
          advance_amount?: number
          advance_payment_mode?: string | null
          balance_amount?: number
          banquet_number?: string | null
          bill_type?: string | null
          billing_company_id?: string | null
          booking_number?: string
          booking_type?: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          check_in?: string
          check_out?: string
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          children?: number
          created_at?: string
          created_by?: string | null
          custom_remark?: string | null
          discount_amount?: number | null
          discount_type?: string | null
          discount_value?: number | null
          end_time?: string | null
          event_date?: string | null
          event_end_date?: string | null
          event_id?: string | null
          event_name?: string | null
          event_status?: string | null
          extra_charge?: number | null
          extra_charge_description?: string | null
          fb_charge?: number | null
          function_type?: string | null
          guest_id?: string | null
          hall_charge?: number | null
          hall_id?: string | null
          host_email?: string | null
          host_mobile?: string | null
          host_name?: string | null
          id?: string
          is_wiped?: boolean
          line_discounts?: Json | null
          notes?: string | null
          ota_partner_name?: string | null
          package_rate?: number | null
          pax?: number | null
          payment_ref?: string | null
          property_id?: string
          rate_type?: string
          restaurant_ledger_balance?: number
          round_off_amount?: number | null
          source?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          total_room_charges?: number
          updated_at?: string
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_billing_company_id_fkey"
            columns: ["billing_company_id"]
            isOneToOne: false
            referencedRelation: "billing_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_hall_id_fkey"
            columns: ["hall_id"]
            isOneToOne: false
            referencedRelation: "halls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_wipe_log_id_fkey"
            columns: ["wipe_log_id"]
            isOneToOne: false
            referencedRelation: "wipe_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_overrides: {
        Row: {
          amount_transferred: number | null
          approved_by: string | null
          approver_email: string | null
          authorized_at: string
          booking_id: string
          created_at: string
          due_date: string | null
          folio_id: string | null
          guest_id: string | null
          id: string
          override_type: string
          pending_amount: number | null
          pending_kot_ids: string[] | null
          property_id: string
          reason: string
          requested_by: string | null
        }
        Insert: {
          amount_transferred?: number | null
          approved_by?: string | null
          approver_email?: string | null
          authorized_at?: string
          booking_id: string
          created_at?: string
          due_date?: string | null
          folio_id?: string | null
          guest_id?: string | null
          id?: string
          override_type?: string
          pending_amount?: number | null
          pending_kot_ids?: string[] | null
          property_id: string
          reason: string
          requested_by?: string | null
        }
        Update: {
          amount_transferred?: number | null
          approved_by?: string | null
          approver_email?: string | null
          authorized_at?: string
          booking_id?: string
          created_at?: string
          due_date?: string | null
          folio_id?: string | null
          guest_id?: string | null
          id?: string
          override_type?: string
          pending_amount?: number | null
          pending_kot_ids?: string[] | null
          property_id?: string
          reason?: string
          requested_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkout_overrides_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "checkout_overrides_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_overrides_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_overrides_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "receivables_aging"
            referencedColumns: ["folio_id"]
          },
          {
            foreignKeyName: "checkout_overrides_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_overrides_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_undo_log: {
        Row: {
          booking_id: string
          folio_id: string | null
          id: string
          original_checkout_at: string
          property_id: string
          undone_at: string
          undone_by: string
        }
        Insert: {
          booking_id: string
          folio_id?: string | null
          id?: string
          original_checkout_at: string
          property_id: string
          undone_at?: string
          undone_by: string
        }
        Update: {
          booking_id?: string
          folio_id?: string | null
          id?: string
          original_checkout_at?: string
          property_id?: string
          undone_at?: string
          undone_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_undo_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "checkout_undo_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_undo_log_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_undo_log_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "receivables_aging"
            referencedColumns: ["folio_id"]
          },
          {
            foreignKeyName: "checkout_undo_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          property_id: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          property_id?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          property_id?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cities_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      client_error_log: {
        Row: {
          component_stack: string | null
          created_at: string
          extra: Json
          id: string
          message: string | null
          property_id: string | null
          route: string | null
          stack: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          component_stack?: string | null
          created_at?: string
          extra?: Json
          id?: string
          message?: string | null
          property_id?: string | null
          route?: string | null
          stack?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          component_stack?: string | null
          created_at?: string
          extra?: Json
          id?: string
          message?: string | null
          property_id?: string | null
          route?: string | null
          stack?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      communications: {
        Row: {
          body: string
          booking_id: string | null
          channel: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          direction: string
          error_message: string | null
          guest_id: string | null
          id: string
          notes: string | null
          property_id: string
          queued_at: string | null
          recipient: string
          recipient_name: string | null
          sent_at: string | null
          status: string
          subject: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          body: string
          booking_id?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          guest_id?: string | null
          id?: string
          notes?: string | null
          property_id: string
          queued_at?: string | null
          recipient: string
          recipient_name?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          booking_id?: string | null
          channel?: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          guest_id?: string | null
          id?: string
          notes?: string | null
          property_id?: string
          queued_at?: string | null
          recipient?: string
          recipient_name?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "communications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      day_closures: {
        Row: {
          bank_total: number
          business_date: string
          card_total: number
          cash_difference: number
          cash_total: number
          closed_at: string
          closed_by: string | null
          closing_cash_actual: number
          closing_cash_expected: number
          created_at: string
          expense_total: number
          gst_amount: number
          id: string
          notes: string | null
          opening_cash: number
          other_total: number
          property_id: string
          rooms_available: number
          rooms_occupied: number
          sub_total: number
          total_amount: number
          upi_total: number
        }
        Insert: {
          bank_total?: number
          business_date: string
          card_total?: number
          cash_difference?: number
          cash_total?: number
          closed_at?: string
          closed_by?: string | null
          closing_cash_actual?: number
          closing_cash_expected?: number
          created_at?: string
          expense_total?: number
          gst_amount?: number
          id?: string
          notes?: string | null
          opening_cash?: number
          other_total?: number
          property_id: string
          rooms_available?: number
          rooms_occupied?: number
          sub_total?: number
          total_amount?: number
          upi_total?: number
        }
        Update: {
          bank_total?: number
          business_date?: string
          card_total?: number
          cash_difference?: number
          cash_total?: number
          closed_at?: string
          closed_by?: string | null
          closing_cash_actual?: number
          closing_cash_expected?: number
          created_at?: string
          expense_total?: number
          gst_amount?: number
          id?: string
          notes?: string | null
          opening_cash?: number
          other_total?: number
          property_id?: string
          rooms_available?: number
          rooms_occupied?: number
          sub_total?: number
          total_amount?: number
          upi_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "day_closures_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      early_checkin_slabs: {
        Row: {
          charge_amount: number
          created_at: string
          effective_from: string
          from_hours: number
          id: string
          is_active: boolean
          property_id: string
          to_hours: number
          updated_at: string
        }
        Insert: {
          charge_amount?: number
          created_at?: string
          effective_from?: string
          from_hours?: number
          id?: string
          is_active?: boolean
          property_id: string
          to_hours?: number
          updated_at?: string
        }
        Update: {
          charge_amount?: number
          created_at?: string
          effective_from?: string
          from_hours?: number
          id?: string
          is_active?: boolean
          property_id?: string
          to_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "early_checkin_slabs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      event_room_blocks: {
        Row: {
          booking_id: string | null
          checked_in_at: string | null
          checked_in_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          checkin_date: string
          checkin_time: string
          checkout_date: string
          checkout_time: string
          created_at: string
          event_booking_id: string | null
          event_name: string
          guest_id: string | null
          guest_mobile: string | null
          guest_name: string | null
          id: string
          property_id: string
          room_category: string | null
          room_id: string | null
          room_number: string | null
          special_rate: number | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          checkin_date: string
          checkin_time?: string
          checkout_date: string
          checkout_time?: string
          created_at?: string
          event_booking_id?: string | null
          event_name: string
          guest_id?: string | null
          guest_mobile?: string | null
          guest_name?: string | null
          id?: string
          property_id: string
          room_category?: string | null
          room_id?: string | null
          room_number?: string | null
          special_rate?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          checkin_date?: string
          checkin_time?: string
          checkout_date?: string
          checkout_time?: string
          created_at?: string
          event_booking_id?: string | null
          event_name?: string
          guest_id?: string | null
          guest_mobile?: string | null
          guest_name?: string | null
          id?: string
          property_id?: string
          room_category?: string | null
          room_id?: string | null
          room_number?: string | null
          special_rate?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_room_blocks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "event_room_blocks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_room_blocks_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "event_room_blocks_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_room_blocks_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_room_blocks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_room_blocks_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          property_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          property_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          expense_date: string
          handover_id: string | null
          id: string
          is_wiped: boolean
          paid_at: string | null
          paid_at_approx: boolean
          paid_to_staff_id: string | null
          payment_mode: string
          property_id: string
          reference: string | null
          updated_at: string
          vendor_id: string | null
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          amount: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          handover_id?: string | null
          id?: string
          is_wiped?: boolean
          paid_at?: string | null
          paid_at_approx?: boolean
          paid_to_staff_id?: string | null
          payment_mode?: string
          property_id: string
          reference?: string | null
          updated_at?: string
          vendor_id?: string | null
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          handover_id?: string | null
          id?: string
          is_wiped?: boolean
          paid_at?: string | null
          paid_at_approx?: boolean
          paid_to_staff_id?: string | null
          payment_mode?: string
          property_id?: string
          reference?: string | null
          updated_at?: string
          vendor_id?: string | null
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_handover_id_fkey"
            columns: ["handover_id"]
            isOneToOne: false
            referencedRelation: "shift_handovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_paid_to_staff_id_fkey"
            columns: ["paid_to_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_wipe_log_id_fkey"
            columns: ["wipe_log_id"]
            isOneToOne: false
            referencedRelation: "wipe_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      folio_charges: {
        Row: {
          amount: number
          charge_type: string
          charged_on: string
          created_at: string
          created_by: string | null
          description: string
          discount_amount: number
          discount_type: string | null
          discount_value: number
          folio_id: string
          gst_amount: number
          gst_rate: number
          hsn_code: string | null
          id: string
          is_wiped: boolean
          qty: number
          rate: number
          segment_bill_ref: string | null
          source_id: string | null
          source_table: string | null
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          amount?: number
          charge_type: string
          charged_on?: string
          created_at?: string
          created_by?: string | null
          description: string
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number
          folio_id: string
          gst_amount?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_wiped?: boolean
          qty?: number
          rate?: number
          segment_bill_ref?: string | null
          source_id?: string | null
          source_table?: string | null
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          amount?: number
          charge_type?: string
          charged_on?: string
          created_at?: string
          created_by?: string | null
          description?: string
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number
          folio_id?: string
          gst_amount?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_wiped?: boolean
          qty?: number
          rate?: number
          segment_bill_ref?: string | null
          source_id?: string | null
          source_table?: string | null
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folio_charges_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_charges_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "receivables_aging"
            referencedColumns: ["folio_id"]
          },
          {
            foreignKeyName: "folio_charges_wipe_log_id_fkey"
            columns: ["wipe_log_id"]
            isOneToOne: false
            referencedRelation: "wipe_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      folios: {
        Row: {
          balance_amount: number
          bill_type: string | null
          billing_company_id: string | null
          billing_guest_id: string | null
          booking_id: string
          complimentary_food_used: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          discount_amount: number
          discount_type: string | null
          discount_value: number
          gst_amount: number
          gst_mode: string
          guest_company: string | null
          guest_gstin: string | null
          id: string
          invoice_number: string | null
          is_deleted: boolean
          is_reopened: boolean
          notes: string | null
          paid_amount: number
          parent_folio_id: string | null
          property_id: string
          round_off_amount: number
          settled_at: string | null
          status: string
          sub_total: number
          total_amount: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          balance_amount?: number
          bill_type?: string | null
          billing_company_id?: string | null
          billing_guest_id?: string | null
          booking_id: string
          complimentary_food_used?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number
          gst_amount?: number
          gst_mode?: string
          guest_company?: string | null
          guest_gstin?: string | null
          id?: string
          invoice_number?: string | null
          is_deleted?: boolean
          is_reopened?: boolean
          notes?: string | null
          paid_amount?: number
          parent_folio_id?: string | null
          property_id: string
          round_off_amount?: number
          settled_at?: string | null
          status?: string
          sub_total?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          balance_amount?: number
          bill_type?: string | null
          billing_company_id?: string | null
          billing_guest_id?: string | null
          booking_id?: string
          complimentary_food_used?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number
          gst_amount?: number
          gst_mode?: string
          guest_company?: string | null
          guest_gstin?: string | null
          id?: string
          invoice_number?: string | null
          is_deleted?: boolean
          is_reopened?: boolean
          notes?: string | null
          paid_amount?: number
          parent_folio_id?: string | null
          property_id?: string
          round_off_amount?: number
          settled_at?: string | null
          status?: string
          sub_total?: number
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folios_billing_company_id_fkey"
            columns: ["billing_company_id"]
            isOneToOne: false
            referencedRelation: "billing_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folios_billing_guest_id_fkey"
            columns: ["billing_guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folios_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "folios_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folios_parent_folio_id_fkey"
            columns: ["parent_folio_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folios_parent_folio_id_fkey"
            columns: ["parent_folio_id"]
            isOneToOne: false
            referencedRelation: "receivables_aging"
            referencedColumns: ["folio_id"]
          },
          {
            foreignKeyName: "folios_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      food_bills: {
        Row: {
          booking_id: string
          created_at: string
          folio_id: string | null
          food_bill_number: string
          id: string
          property_id: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          folio_id?: string | null
          food_bill_number: string
          id?: string
          property_id: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          folio_id?: string | null
          food_bill_number?: string
          id?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_bills_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "food_bills_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_bills_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_bills_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "receivables_aging"
            referencedColumns: ["folio_id"]
          },
          {
            foreignKeyName: "food_bills_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      grc_records: {
        Row: {
          address: string | null
          arrival_from: string | null
          billing_instruction: string | null
          booking_id: string
          city: string | null
          company: string | null
          country: string | null
          created_at: string
          created_by: string | null
          designation: string | null
          discount_note: string | null
          duty_manager_name: string | null
          grc_number: string | null
          id: string
          mode_of_payment: string | null
          preceding_to: string | null
          property_id: string
          purpose_of_visit: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          arrival_from?: string | null
          billing_instruction?: string | null
          booking_id: string
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          designation?: string | null
          discount_note?: string | null
          duty_manager_name?: string | null
          grc_number?: string | null
          id?: string
          mode_of_payment?: string | null
          preceding_to?: string | null
          property_id: string
          purpose_of_visit?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          arrival_from?: string | null
          billing_instruction?: string | null
          booking_id?: string
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          designation?: string | null
          discount_note?: string | null
          duty_manager_name?: string | null
          grc_number?: string | null
          id?: string
          mode_of_payment?: string | null
          preceding_to?: string | null
          property_id?: string
          purpose_of_visit?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grc_records_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "grc_records_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grc_records_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_slabs: {
        Row: {
          active: boolean
          charge_category: string
          created_at: string
          effective_from: string
          from_amount: number
          gst_rate: number
          id: string
          is_active: boolean
          property_id: string
          to_amount: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          charge_category?: string
          created_at?: string
          effective_from?: string
          from_amount?: number
          gst_rate?: number
          id?: string
          is_active?: boolean
          property_id: string
          to_amount?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          charge_category?: string
          created_at?: string
          effective_from?: string
          from_amount?: number
          gst_rate?: number
          id?: string
          is_active?: boolean
          property_id?: string
          to_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gst_slabs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_documents: {
        Row: {
          booking_id: string | null
          document_name: string | null
          drive_file_id: string | null
          drive_folder_path: string | null
          drive_view_url: string | null
          guest_id: string | null
          id: string
          property_id: string
          side: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          booking_id?: string | null
          document_name?: string | null
          drive_file_id?: string | null
          drive_folder_path?: string | null
          drive_view_url?: string | null
          guest_id?: string | null
          id?: string
          property_id: string
          side?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          booking_id?: string | null
          document_name?: string | null
          drive_file_id?: string | null
          drive_folder_path?: string | null
          drive_view_url?: string | null
          guest_id?: string | null
          id?: string
          property_id?: string
          side?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "guest_documents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_documents_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_documents_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guest_feedback: {
        Row: {
          booking_id: string | null
          cleanliness_rating: number | null
          comments: string | null
          created_at: string
          created_by: string | null
          feedback_date: string
          food_rating: number | null
          guest_id: string | null
          guest_name: string | null
          id: string
          overall_rating: number
          property_id: string
          responded_at: string | null
          responded_by: string | null
          response_text: string | null
          service_rating: number | null
          source: string
          status: string
          updated_at: string
          value_rating: number | null
          would_recommend: boolean | null
        }
        Insert: {
          booking_id?: string | null
          cleanliness_rating?: number | null
          comments?: string | null
          created_at?: string
          created_by?: string | null
          feedback_date?: string
          food_rating?: number | null
          guest_id?: string | null
          guest_name?: string | null
          id?: string
          overall_rating: number
          property_id: string
          responded_at?: string | null
          responded_by?: string | null
          response_text?: string | null
          service_rating?: number | null
          source?: string
          status?: string
          updated_at?: string
          value_rating?: number | null
          would_recommend?: boolean | null
        }
        Update: {
          booking_id?: string | null
          cleanliness_rating?: number | null
          comments?: string | null
          created_at?: string
          created_by?: string | null
          feedback_date?: string
          food_rating?: number | null
          guest_id?: string | null
          guest_name?: string | null
          id?: string
          overall_rating?: number
          property_id?: string
          responded_at?: string | null
          responded_by?: string | null
          response_text?: string | null
          service_rating?: number | null
          source?: string
          status?: string
          updated_at?: string
          value_rating?: number | null
          would_recommend?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_feedback_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "guest_feedback_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_feedback_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_feedback_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          address: string | null
          city: string | null
          company: string | null
          country: string | null
          created_at: string
          created_by: string | null
          dob: string | null
          email: string | null
          gender: string | null
          gst_number: string | null
          guest_type: string
          id: string
          id_document_back_name: string | null
          id_document_back_uploaded_at: string | null
          id_document_back_url: string | null
          id_document_name: string | null
          id_document_uploaded_at: string | null
          id_document_url: string | null
          id_proof_number: string | null
          id_proof_type: string | null
          is_blacklisted: boolean
          is_wiped: boolean
          mobile: string | null
          name: string
          nationality: string | null
          notes: string | null
          photo_url: string | null
          pincode: string | null
          property_id: string
          state: string | null
          state_code: string | null
          tags: string[]
          updated_at: string
          visit_count: number
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          email?: string | null
          gender?: string | null
          gst_number?: string | null
          guest_type?: string
          id?: string
          id_document_back_name?: string | null
          id_document_back_uploaded_at?: string | null
          id_document_back_url?: string | null
          id_document_name?: string | null
          id_document_uploaded_at?: string | null
          id_document_url?: string | null
          id_proof_number?: string | null
          id_proof_type?: string | null
          is_blacklisted?: boolean
          is_wiped?: boolean
          mobile?: string | null
          name: string
          nationality?: string | null
          notes?: string | null
          photo_url?: string | null
          pincode?: string | null
          property_id: string
          state?: string | null
          state_code?: string | null
          tags?: string[]
          updated_at?: string
          visit_count?: number
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          dob?: string | null
          email?: string | null
          gender?: string | null
          gst_number?: string | null
          guest_type?: string
          id?: string
          id_document_back_name?: string | null
          id_document_back_uploaded_at?: string | null
          id_document_back_url?: string | null
          id_document_name?: string | null
          id_document_uploaded_at?: string | null
          id_document_url?: string | null
          id_proof_number?: string | null
          id_proof_type?: string | null
          is_blacklisted?: boolean
          is_wiped?: boolean
          mobile?: string | null
          name?: string
          nationality?: string | null
          notes?: string | null
          photo_url?: string | null
          pincode?: string | null
          property_id?: string
          state?: string | null
          state_code?: string | null
          tags?: string[]
          updated_at?: string
          visit_count?: number
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_wipe_log_id_fkey"
            columns: ["wipe_log_id"]
            isOneToOne: false
            referencedRelation: "wipe_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      halls: {
        Row: {
          capacity: number
          created_at: string
          day_rate: number
          hourly_rate: number
          id: string
          is_active: boolean
          location: string | null
          name: string
          notes: string | null
          property_id: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          day_rate?: number
          hourly_rate?: number
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          notes?: string | null
          property_id: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          day_rate?: number
          hourly_rate?: number
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          notes?: string | null
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "halls_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      housekeeping_room_notes: {
        Row: {
          created_at: string
          note: string
          property_id: string
          room_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          note?: string
          property_id: string
          room_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          note?: string
          property_id?: string
          room_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "housekeeping_room_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housekeeping_room_notes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      housekeeping_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          notes: string | null
          priority: string
          property_id: string
          room_id: string | null
          status: string
          task_type: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          priority?: string
          property_id: string
          room_id?: string | null
          status?: string
          task_type?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          priority?: string
          property_id?: string
          room_id?: string | null
          status?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "housekeeping_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housekeeping_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housekeeping_tasks_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string
          created_at: string
          current_stock: number
          id: string
          is_active: boolean
          last_rate: number
          name: string
          property_id: string
          reorder_level: number
          sku: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          current_stock?: number
          id?: string
          is_active?: boolean
          last_rate?: number
          name: string
          property_id: string
          reorder_level?: number
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          current_stock?: number
          id?: string
          is_active?: boolean
          last_rate?: number
          name?: string
          property_id?: string
          reorder_level?: number
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      kot_audit_log: {
        Row: {
          actor: string | null
          created_at: string
          event_type: string
          id: string
          kot_order_id: string | null
          message: string
          meta: Json | null
          property_id: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          event_type: string
          id?: string
          kot_order_id?: string | null
          message: string
          meta?: Json | null
          property_id?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          event_type?: string
          id?: string
          kot_order_id?: string | null
          message?: string
          meta?: Json | null
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kot_audit_log_kot_order_id_fkey"
            columns: ["kot_order_id"]
            isOneToOne: false
            referencedRelation: "kot_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_audit_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      kot_items: {
        Row: {
          amount: number
          created_at: string
          gst_rate: number
          id: string
          is_void: boolean
          is_wiped: boolean
          item_name: string
          kot_id: string
          kot_station: string
          menu_item_id: string | null
          notes: string | null
          qty: number
          rate: number
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          gst_rate?: number
          id?: string
          is_void?: boolean
          is_wiped?: boolean
          item_name: string
          kot_id: string
          kot_station?: string
          menu_item_id?: string | null
          notes?: string | null
          qty?: number
          rate?: number
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          gst_rate?: number
          id?: string
          is_void?: boolean
          is_wiped?: boolean
          item_name?: string
          kot_id?: string
          kot_station?: string
          menu_item_id?: string | null
          notes?: string | null
          qty?: number
          rate?: number
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kot_items_kot_id_fkey"
            columns: ["kot_id"]
            isOneToOne: false
            referencedRelation: "kot_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_items_wipe_log_id_fkey"
            columns: ["wipe_log_id"]
            isOneToOne: false
            referencedRelation: "wipe_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      kot_orders: {
        Row: {
          billed_at: string | null
          booking_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string | null
          delivery_photo_taken_at: string | null
          delivery_photo_taken_by: string | null
          delivery_proof_url: string | null
          edited_at: string | null
          edited_by: string | null
          gst_amount: number
          guest_name: string | null
          id: string
          is_wiped: boolean
          kot_copy: string
          kot_number: string
          kot_type: string
          notes: string | null
          parent_kot_id: string | null
          printed_at: string | null
          property_id: string
          room_id: string | null
          served_at: string | null
          status: string
          sub_total: number
          table_no: string | null
          total_amount: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          billed_at?: string | null
          booking_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          delivery_photo_taken_at?: string | null
          delivery_photo_taken_by?: string | null
          delivery_proof_url?: string | null
          edited_at?: string | null
          edited_by?: string | null
          gst_amount?: number
          guest_name?: string | null
          id?: string
          is_wiped?: boolean
          kot_copy?: string
          kot_number?: string
          kot_type?: string
          notes?: string | null
          parent_kot_id?: string | null
          printed_at?: string | null
          property_id: string
          room_id?: string | null
          served_at?: string | null
          status?: string
          sub_total?: number
          table_no?: string | null
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          billed_at?: string | null
          booking_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          delivery_photo_taken_at?: string | null
          delivery_photo_taken_by?: string | null
          delivery_proof_url?: string | null
          edited_at?: string | null
          edited_by?: string | null
          gst_amount?: number
          guest_name?: string | null
          id?: string
          is_wiped?: boolean
          kot_copy?: string
          kot_number?: string
          kot_type?: string
          notes?: string | null
          parent_kot_id?: string | null
          printed_at?: string | null
          property_id?: string
          room_id?: string | null
          served_at?: string | null
          status?: string
          sub_total?: number
          table_no?: string | null
          total_amount?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kot_orders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "kot_orders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_orders_parent_kot_id_fkey"
            columns: ["parent_kot_id"]
            isOneToOne: false
            referencedRelation: "kot_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_orders_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_orders_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kot_orders_wipe_log_id_fkey"
            columns: ["wipe_log_id"]
            isOneToOne: false
            referencedRelation: "wipe_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      label_company_settings: {
        Row: {
          address: string | null
          company_name: string | null
          customer_care_number: string | null
          email: string | null
          facebook_url: string | null
          fssai_lic_no: string | null
          instagram_url: string | null
          property_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_name?: string | null
          customer_care_number?: string | null
          email?: string | null
          facebook_url?: string | null
          fssai_lic_no?: string | null
          instagram_url?: string | null
          property_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_name?: string | null
          customer_care_number?: string | null
          email?: string | null
          facebook_url?: string | null
          fssai_lic_no?: string | null
          instagram_url?: string | null
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_company_settings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      label_nutrient_master: {
        Row: {
          created_at: string
          default_show_rda: boolean
          display_order: number
          id: string
          is_active: boolean
          key: string
          label: string
          property_id: string
          rda_reference: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_show_rda?: boolean
          display_order?: number
          id?: string
          is_active?: boolean
          key: string
          label: string
          property_id: string
          rda_reference?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_show_rda?: boolean
          display_order?: number
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          property_id?: string
          rda_reference?: number | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_nutrient_master_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      label_print_batches: {
        Row: {
          batch_no: string | null
          created_at: string
          expiry_on: string
          id: string
          mrp: number | null
          notes: string | null
          packed_on: string
          printed_by: string | null
          product_id: string
          property_id: string
          quantity: number
          template_used: string | null
        }
        Insert: {
          batch_no?: string | null
          created_at?: string
          expiry_on: string
          id?: string
          mrp?: number | null
          notes?: string | null
          packed_on?: string
          printed_by?: string | null
          product_id: string
          property_id: string
          quantity: number
          template_used?: string | null
        }
        Update: {
          batch_no?: string | null
          created_at?: string
          expiry_on?: string
          id?: string
          mrp?: number | null
          notes?: string | null
          packed_on?: string
          printed_by?: string | null
          product_id?: string
          property_id?: string
          quantity?: number
          template_used?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "label_print_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "label_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_print_batches_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      label_products: {
        Row: {
          address_override: string | null
          allergen_info: string | null
          batch_no: string | null
          company_name_override: string | null
          created_at: string
          created_by: string | null
          customer_care_override: string | null
          default_label_template: string | null
          email_override: string | null
          fssai_lic_override: string | null
          fssai_no: string | null
          id: string
          ingredients: string | null
          is_active: boolean
          mrp: number | null
          name: string
          net_weight: string | null
          nutrition_info: Json | null
          property_id: string
          serving_size_g: number | null
          servings_per_package: number | null
          shelf_life_days: number
          storage_instructions: string | null
          updated_at: string
        }
        Insert: {
          address_override?: string | null
          allergen_info?: string | null
          batch_no?: string | null
          company_name_override?: string | null
          created_at?: string
          created_by?: string | null
          customer_care_override?: string | null
          default_label_template?: string | null
          email_override?: string | null
          fssai_lic_override?: string | null
          fssai_no?: string | null
          id?: string
          ingredients?: string | null
          is_active?: boolean
          mrp?: number | null
          name: string
          net_weight?: string | null
          nutrition_info?: Json | null
          property_id: string
          serving_size_g?: number | null
          servings_per_package?: number | null
          shelf_life_days?: number
          storage_instructions?: string | null
          updated_at?: string
        }
        Update: {
          address_override?: string | null
          allergen_info?: string | null
          batch_no?: string | null
          company_name_override?: string | null
          created_at?: string
          created_by?: string | null
          customer_care_override?: string | null
          default_label_template?: string | null
          email_override?: string | null
          fssai_lic_override?: string | null
          fssai_no?: string | null
          id?: string
          ingredients?: string | null
          is_active?: boolean
          mrp?: number | null
          name?: string
          net_weight?: string | null
          nutrition_info?: Json | null
          property_id?: string
          serving_size_g?: number | null
          servings_per_package?: number | null
          shelf_life_days?: number
          storage_instructions?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_products_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kot_printer_id: string | null
          kot_type: Database["public"]["Enums"]["kot_type"]
          name: string
          property_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kot_printer_id?: string | null
          kot_type?: Database["public"]["Enums"]["kot_type"]
          name: string
          property_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kot_printer_id?: string | null
          kot_type?: Database["public"]["Enums"]["kot_type"]
          name?: string
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_kot_printer_id_fkey"
            columns: ["kot_printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          category_id: string | null
          code: string | null
          created_at: string
          gst_rate: number
          hsn_code: string | null
          id: string
          is_available: boolean
          is_veg: boolean
          kitchen_printer_id: string | null
          kitchen_type: string
          kot_station: string
          name: string
          price: number
          property_id: string
          short_code: string | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          code?: string | null
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_available?: boolean
          is_veg?: boolean
          kitchen_printer_id?: string | null
          kitchen_type?: string
          kot_station?: string
          name: string
          price?: number
          property_id: string
          short_code?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          code?: string | null
          created_at?: string
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_available?: boolean
          is_veg?: boolean
          kitchen_printer_id?: string | null
          kitchen_type?: string
          kot_station?: string
          name?: string
          price?: number
          property_id?: string
          short_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_kitchen_printer_id_fkey"
            columns: ["kitchen_printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          aisensy_campaign_name: string | null
          body: string
          channel: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          property_id: string
          subject: string | null
          trigger_event: string | null
          updated_at: string
        }
        Insert: {
          aisensy_campaign_name?: string | null
          body: string
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          property_id: string
          subject?: string | null
          trigger_event?: string | null
          updated_at?: string
        }
        Update: {
          aisensy_campaign_name?: string | null
          body?: string
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          property_id?: string
          subject?: string | null
          trigger_event?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      night_audit_reports: {
        Row: {
          audit_date: string
          banquet_revenue: number
          cash_difference: number
          closed_at: string
          closed_by: string | null
          closing_cash_actual: number
          closing_cash_expected: number
          created_at: string
          food_revenue: number
          id: string
          notes: string | null
          occupancy_count: number
          opening_cash: number
          other_revenue: number
          property_id: string
          report_data: Json | null
          room_revenue: number
          rooms_total: number
          total_collections: number
          total_expenses: number
          total_revenue: number
        }
        Insert: {
          audit_date: string
          banquet_revenue?: number
          cash_difference?: number
          closed_at?: string
          closed_by?: string | null
          closing_cash_actual?: number
          closing_cash_expected?: number
          created_at?: string
          food_revenue?: number
          id?: string
          notes?: string | null
          occupancy_count?: number
          opening_cash?: number
          other_revenue?: number
          property_id: string
          report_data?: Json | null
          room_revenue?: number
          rooms_total?: number
          total_collections?: number
          total_expenses?: number
          total_revenue?: number
        }
        Update: {
          audit_date?: string
          banquet_revenue?: number
          cash_difference?: number
          closed_at?: string
          closed_by?: string | null
          closing_cash_actual?: number
          closing_cash_expected?: number
          created_at?: string
          food_revenue?: number
          id?: string
          notes?: string | null
          occupancy_count?: number
          opening_cash?: number
          other_revenue?: number
          property_id?: string
          report_data?: Json | null
          room_revenue?: number
          rooms_total?: number
          total_collections?: number
          total_expenses?: number
          total_revenue?: number
        }
        Relationships: [
          {
            foreignKeyName: "night_audit_reports_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "night_audit_reports_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ota_channel_mappings: {
        Row: {
          category_id: string | null
          channel_id: string
          created_at: string
          id: string
          is_active: boolean
          ota_rate_code: string | null
          ota_room_code: string | null
          property_id: string
          rate_offset_pct: number
          tariff_id: string | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          channel_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          ota_rate_code?: string | null
          ota_room_code?: string | null
          property_id: string
          rate_offset_pct?: number
          tariff_id?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          channel_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          ota_rate_code?: string | null
          ota_room_code?: string | null
          property_id?: string
          rate_offset_pct?: number
          tariff_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ota_channel_mappings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "room_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ota_channel_mappings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ota_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ota_channel_mappings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ota_channel_mappings_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariff_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      ota_channels: {
        Row: {
          code: string
          commission_pct: number
          contact_email: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          property_id: string
          updated_at: string
        }
        Insert: {
          code: string
          commission_pct?: number
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          property_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          commission_pct?: number
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ota_channels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      ota_sync_logs: {
        Row: {
          channel_id: string | null
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          message: string | null
          payload: Json | null
          property_id: string
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          message?: string | null
          payload?: Json | null
          property_id: string
          started_at?: string
          status?: string
          sync_type: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          message?: string | null
          payload?: Json | null
          property_id?: string
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ota_sync_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ota_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ota_sync_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          property_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          property_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          booking_id: string | null
          created_at: string
          created_by: string | null
          folio_id: string
          id: string
          is_wiped: boolean
          mode: string
          notes: string | null
          paid_at: string
          property_id: string
          reference_no: string | null
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          amount: number
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          folio_id: string
          id?: string
          is_wiped?: boolean
          mode: string
          notes?: string | null
          paid_at?: string
          property_id: string
          reference_no?: string | null
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          folio_id?: string
          id?: string
          is_wiped?: boolean
          mode?: string
          notes?: string | null
          paid_at?: string
          property_id?: string
          reference_no?: string | null
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "receivables_aging"
            referencedColumns: ["folio_id"]
          },
          {
            foreignKeyName: "payments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_wipe_log_id_fkey"
            columns: ["wipe_log_id"]
            isOneToOne: false
            referencedRelation: "wipe_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          absent_days: number
          advance: number
          bonus: number
          created_at: string
          created_by: string | null
          deductions: number
          gross_salary: number
          id: string
          net_pay: number
          notes: string | null
          paid_at: string | null
          paid_via: string | null
          period_month: string
          present_days: number
          property_id: string
          staff_id: string
          status: string
          total_days: number
          updated_at: string
        }
        Insert: {
          absent_days?: number
          advance?: number
          bonus?: number
          created_at?: string
          created_by?: string | null
          deductions?: number
          gross_salary?: number
          id?: string
          net_pay?: number
          notes?: string | null
          paid_at?: string | null
          paid_via?: string | null
          period_month: string
          present_days?: number
          property_id: string
          staff_id: string
          status?: string
          total_days?: number
          updated_at?: string
        }
        Update: {
          absent_days?: number
          advance?: number
          bonus?: number
          created_at?: string
          created_by?: string | null
          deductions?: number
          gross_salary?: number
          id?: string
          net_pay?: number
          notes?: string | null
          paid_at?: string | null
          paid_via?: string | null
          period_month?: string
          present_days?: number
          property_id?: string
          staff_id?: string
          status?: string
          total_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          created_at: string
          id: string
          module: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          module: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          module?: string
        }
        Relationships: []
      }
      petty_cash_entries: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          created_by_name: string | null
          deleted_at: string | null
          deleted_by: string | null
          entry_type: Database["public"]["Enums"]["petty_cash_entry_type"]
          handover_id: string | null
          id: string
          is_deleted: boolean
          property_id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          entry_type: Database["public"]["Enums"]["petty_cash_entry_type"]
          handover_id?: string | null
          id?: string
          is_deleted?: boolean
          property_id: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          entry_type?: Database["public"]["Enums"]["petty_cash_entry_type"]
          handover_id?: string | null
          id?: string
          is_deleted?: boolean
          property_id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_entries_handover_id_fkey"
            columns: ["handover_id"]
            isOneToOne: false
            referencedRelation: "shift_handovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_entries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          property_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          property_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_categories_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_charges: {
        Row: {
          amount: number
          billed_at: string | null
          booking_id: string
          category_id: string | null
          category_name: string
          created_at: string
          created_by: string | null
          description: string
          folio_charge_id: string | null
          gst_amount: number
          gst_rate: number
          id: string
          property_id: string
          qty: number
          rate: number
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number
          billed_at?: string | null
          booking_id: string
          category_id?: string | null
          category_name: string
          created_at?: string
          created_by?: string | null
          description: string
          folio_charge_id?: string | null
          gst_amount?: number
          gst_rate?: number
          id?: string
          property_id: string
          qty?: number
          rate?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          billed_at?: string | null
          booking_id?: string
          category_id?: string | null
          category_name?: string
          created_at?: string
          created_by?: string | null
          description?: string
          folio_charge_id?: string | null
          gst_amount?: number
          gst_rate?: number
          id?: string
          property_id?: string
          qty?: number
          rate?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "pos_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_charges_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "pos_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_charges_folio_charge_id_fkey"
            columns: ["folio_charge_id"]
            isOneToOne: false
            referencedRelation: "folio_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_charges_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      printer_roles: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          property_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          property_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "printer_roles_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      printers: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          is_active: boolean
          is_default: boolean
          location: string | null
          name: string
          paper_size: string | null
          port: number | null
          printer_role: string
          property_id: string
          station: string | null
          type: Database["public"]["Enums"]["printer_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          is_default?: boolean
          location?: string | null
          name: string
          paper_size?: string | null
          port?: number | null
          printer_role?: string
          property_id: string
          station?: string | null
          type?: Database["public"]["Enums"]["printer_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          is_active?: boolean
          is_default?: boolean
          location?: string | null
          name?: string
          paper_size?: string | null
          port?: number | null
          printer_role?: string
          property_id?: string
          station?: string | null
          type?: Database["public"]["Enums"]["printer_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "printers_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          mobile: string | null
          name: string | null
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          is_active?: boolean
          mobile?: string | null
          name?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          mobile?: string | null
          name?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string | null
          address_line1: string | null
          address_line2: string | null
          aisensy_api_key: string | null
          checkin_time: string | null
          checkout_grace_time: string
          checkout_time: string | null
          city: string | null
          created_at: string
          currency: string | null
          default_checkin_time: string | null
          default_checkout_time: string | null
          early_checkin_charge: number | null
          early_checkin_charge_per_hour: number | null
          email: string | null
          fiscal_year_start: string | null
          food_gst_rate: number
          fssai: string | null
          grc_terms: string | null
          gstin: string | null
          id: string
          invoice_footer: string | null
          invoice_prefix: string | null
          invoice_primary_color: string | null
          invoice_show_gst_breakup: boolean | null
          invoice_show_hsn: boolean | null
          invoice_show_powered_by: boolean | null
          invoice_show_signature: boolean | null
          invoice_start_number: number | null
          invoice_template: string | null
          is_active: boolean
          late_checkout_charge: number | null
          late_checkout_charge_per_hour: number | null
          legal_entity_name: string | null
          logo_url: string | null
          name: string
          pan: string | null
          pan_number: string | null
          phone: string | null
          pin_code: string | null
          pincode: string | null
          require_delivery_proof: boolean
          short_code: string | null
          star_rating: number | null
          state: string | null
          state_code: string | null
          status: string
          sundry_gst_rate: number
          tagline: string | null
          total_floors: number | null
          total_rooms: number | null
          updated_at: string
          use_gst_slabs: boolean
          wa_number: string | null
          website: string | null
          wifi_password: string | null
        }
        Insert: {
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          aisensy_api_key?: string | null
          checkin_time?: string | null
          checkout_grace_time?: string
          checkout_time?: string | null
          city?: string | null
          created_at?: string
          currency?: string | null
          default_checkin_time?: string | null
          default_checkout_time?: string | null
          early_checkin_charge?: number | null
          early_checkin_charge_per_hour?: number | null
          email?: string | null
          fiscal_year_start?: string | null
          food_gst_rate?: number
          fssai?: string | null
          grc_terms?: string | null
          gstin?: string | null
          id?: string
          invoice_footer?: string | null
          invoice_prefix?: string | null
          invoice_primary_color?: string | null
          invoice_show_gst_breakup?: boolean | null
          invoice_show_hsn?: boolean | null
          invoice_show_powered_by?: boolean | null
          invoice_show_signature?: boolean | null
          invoice_start_number?: number | null
          invoice_template?: string | null
          is_active?: boolean
          late_checkout_charge?: number | null
          late_checkout_charge_per_hour?: number | null
          legal_entity_name?: string | null
          logo_url?: string | null
          name: string
          pan?: string | null
          pan_number?: string | null
          phone?: string | null
          pin_code?: string | null
          pincode?: string | null
          require_delivery_proof?: boolean
          short_code?: string | null
          star_rating?: number | null
          state?: string | null
          state_code?: string | null
          status?: string
          sundry_gst_rate?: number
          tagline?: string | null
          total_floors?: number | null
          total_rooms?: number | null
          updated_at?: string
          use_gst_slabs?: boolean
          wa_number?: string | null
          website?: string | null
          wifi_password?: string | null
        }
        Update: {
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          aisensy_api_key?: string | null
          checkin_time?: string | null
          checkout_grace_time?: string
          checkout_time?: string | null
          city?: string | null
          created_at?: string
          currency?: string | null
          default_checkin_time?: string | null
          default_checkout_time?: string | null
          early_checkin_charge?: number | null
          early_checkin_charge_per_hour?: number | null
          email?: string | null
          fiscal_year_start?: string | null
          food_gst_rate?: number
          fssai?: string | null
          grc_terms?: string | null
          gstin?: string | null
          id?: string
          invoice_footer?: string | null
          invoice_prefix?: string | null
          invoice_primary_color?: string | null
          invoice_show_gst_breakup?: boolean | null
          invoice_show_hsn?: boolean | null
          invoice_show_powered_by?: boolean | null
          invoice_show_signature?: boolean | null
          invoice_start_number?: number | null
          invoice_template?: string | null
          is_active?: boolean
          late_checkout_charge?: number | null
          late_checkout_charge_per_hour?: number | null
          legal_entity_name?: string | null
          logo_url?: string | null
          name?: string
          pan?: string | null
          pan_number?: string | null
          phone?: string | null
          pin_code?: string | null
          pincode?: string | null
          require_delivery_proof?: boolean
          short_code?: string | null
          star_rating?: number | null
          state?: string | null
          state_code?: string | null
          status?: string
          sundry_gst_rate?: number
          tagline?: string | null
          total_floors?: number | null
          total_rooms?: number | null
          updated_at?: string
          use_gst_slabs?: boolean
          wa_number?: string | null
          website?: string | null
          wifi_password?: string | null
        }
        Relationships: []
      }
      property_settings: {
        Row: {
          created_at: string
          property_id: string
          room_grouping: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          property_id: string
          room_grouping?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          property_id?: string
          room_grouping?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_settings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_seasons: {
        Row: {
          applies_to_category_id: string | null
          color: string
          created_at: string
          end_date: string
          id: string
          is_active: boolean
          multiplier: number
          name: string
          notes: string | null
          priority: number
          property_id: string
          season_type: string
          start_date: string
          updated_at: string
        }
        Insert: {
          applies_to_category_id?: string | null
          color?: string
          created_at?: string
          end_date: string
          id?: string
          is_active?: boolean
          multiplier?: number
          name: string
          notes?: string | null
          priority?: number
          property_id: string
          season_type?: string
          start_date: string
          updated_at?: string
        }
        Update: {
          applies_to_category_id?: string | null
          color?: string
          created_at?: string
          end_date?: string
          id?: string
          is_active?: boolean
          multiplier?: number
          name?: string
          notes?: string | null
          priority?: number
          property_id?: string
          season_type?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_seasons_applies_to_category_id_fkey"
            columns: ["applies_to_category_id"]
            isOneToOne: false
            referencedRelation: "room_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_seasons_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          is_dismissed: boolean
          is_read: boolean
          message: string | null
          notes: string | null
          property_id: string
          read_at: string | null
          read_by: string | null
          related_record_id: string | null
          reminder_datetime: string
          reminder_day: string | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          message?: string | null
          notes?: string | null
          property_id: string
          read_at?: string | null
          read_by?: string | null
          related_record_id?: string | null
          reminder_datetime: string
          reminder_day?: string | null
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          message?: string | null
          notes?: string | null
          property_id?: string
          read_at?: string | null
          read_by?: string | null
          related_record_id?: string | null
          reminder_datetime?: string
          reminder_day?: string | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_credits: {
        Row: {
          amount: number
          booking_id: string | null
          created_at: string
          date: string
          description: string | null
          id: string
          is_settled: boolean
          kot_order_id: string | null
          property_id: string
          room_id: string | null
          settlement_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          booking_id?: string | null
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          is_settled?: boolean
          kot_order_id?: string | null
          property_id: string
          room_id?: string | null
          settlement_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string | null
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          is_settled?: boolean
          kot_order_id?: string | null
          property_id?: string
          room_id?: string | null
          settlement_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_credits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "restaurant_credits_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_credits_kot_order_id_fkey"
            columns: ["kot_order_id"]
            isOneToOne: false
            referencedRelation: "kot_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_credits_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_credits_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_direct_charges: {
        Row: {
          amount: number
          bill_no: string | null
          booking_id: string | null
          charge_date: string
          created_at: string
          description: string | null
          folio_charge_id: string | null
          guest_id: string | null
          id: string
          is_settled: boolean
          outlet_id: string | null
          posted_by: string | null
          property_id: string
          settled_at: string | null
          settled_by: string | null
        }
        Insert: {
          amount: number
          bill_no?: string | null
          booking_id?: string | null
          charge_date?: string
          created_at?: string
          description?: string | null
          folio_charge_id?: string | null
          guest_id?: string | null
          id?: string
          is_settled?: boolean
          outlet_id?: string | null
          posted_by?: string | null
          property_id: string
          settled_at?: string | null
          settled_by?: string | null
        }
        Update: {
          amount?: number
          bill_no?: string | null
          booking_id?: string | null
          charge_date?: string
          created_at?: string
          description?: string | null
          folio_charge_id?: string | null
          guest_id?: string | null
          id?: string
          is_settled?: boolean
          outlet_id?: string | null
          posted_by?: string | null
          property_id?: string
          settled_at?: string | null
          settled_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_direct_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "restaurant_direct_charges_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_direct_charges_folio_charge_id_fkey"
            columns: ["folio_charge_id"]
            isOneToOne: false
            referencedRelation: "folio_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_direct_charges_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_direct_charges_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "restaurant_outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_direct_charges_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_direct_charges_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_direct_charges_settled_by_fkey"
            columns: ["settled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_outlets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          property_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          property_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_outlets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_payables: {
        Row: {
          amount: number
          bill_no: string | null
          charge_date: string
          charge_id: string | null
          created_at: string
          description: string | null
          id: string
          is_settled: boolean
          property_id: string
          settlement_date: string | null
          settlement_notes: string | null
        }
        Insert: {
          amount: number
          bill_no?: string | null
          charge_date: string
          charge_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_settled?: boolean
          property_id: string
          settlement_date?: string | null
          settlement_notes?: string | null
        }
        Update: {
          amount?: number
          bill_no?: string | null
          charge_date?: string
          charge_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_settled?: boolean
          property_id?: string
          settlement_date?: string | null
          settlement_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_payables_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "restaurant_direct_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_payables_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_settlements: {
        Row: {
          created_at: string
          id: string
          month: number
          notes: string | null
          payment_mode: string | null
          property_id: string
          settled_amount: number
          settlement_date: string
          total_amount: number
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          month: number
          notes?: string | null
          payment_mode?: string | null
          property_id: string
          settled_amount?: number
          settlement_date?: string
          total_amount?: number
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          month?: number
          notes?: string | null
          payment_mode?: string | null
          property_id?: string
          settled_amount?: number
          settlement_date?: string
          total_amount?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_settlements_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          default_route: string | null
          description: string | null
          id: string
          is_system: boolean
          max_discount_amount: number
          max_discount_pct: number
          max_discount_type: string
          name: string
          property_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_route?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          max_discount_amount?: number
          max_discount_pct?: number
          max_discount_type?: string
          name: string
          property_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_route?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          max_discount_amount?: number
          max_discount_pct?: number
          max_discount_type?: string
          name?: string
          property_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      room_categories: {
        Row: {
          base_rate: number
          code: string | null
          complimentary_food_limit_per_person: number
          created_at: string
          description: string | null
          extra_bed_rate: number
          gst_rate: number
          hsn_code: string | null
          id: string
          is_active: boolean
          max_occupancy: number
          name: string
          property_id: string
          updated_at: string
        }
        Insert: {
          base_rate?: number
          code?: string | null
          complimentary_food_limit_per_person?: number
          created_at?: string
          description?: string | null
          extra_bed_rate?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_active?: boolean
          max_occupancy?: number
          name: string
          property_id: string
          updated_at?: string
        }
        Update: {
          base_rate?: number
          code?: string | null
          complimentary_food_limit_per_person?: number
          created_at?: string
          description?: string | null
          extra_bed_rate?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_active?: boolean
          max_occupancy?: number
          name?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_categories_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      room_shifts: {
        Row: {
          booking_room_id: string
          from_room_id: string | null
          id: string
          new_rate: number | null
          old_rate: number | null
          property_id: string
          rate_applied: number | null
          rate_type: string | null
          reason: string | null
          shifted_at: string
          shifted_by: string | null
          tariff_choice: string | null
          to_room_id: string | null
        }
        Insert: {
          booking_room_id: string
          from_room_id?: string | null
          id?: string
          new_rate?: number | null
          old_rate?: number | null
          property_id: string
          rate_applied?: number | null
          rate_type?: string | null
          reason?: string | null
          shifted_at?: string
          shifted_by?: string | null
          tariff_choice?: string | null
          to_room_id?: string | null
        }
        Update: {
          booking_room_id?: string
          from_room_id?: string | null
          id?: string
          new_rate?: number | null
          old_rate?: number | null
          property_id?: string
          rate_applied?: number | null
          rate_type?: string | null
          reason?: string | null
          shifted_at?: string
          shifted_by?: string | null
          tariff_choice?: string | null
          to_room_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_shifts_booking_room_id_fkey"
            columns: ["booking_room_id"]
            isOneToOne: false
            referencedRelation: "booking_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_shifts_from_room_id_fkey"
            columns: ["from_room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_shifts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_shifts_to_room_id_fkey"
            columns: ["to_room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_status_color_settings: {
        Row: {
          bg_color: string | null
          created_at: string
          fg_color: string | null
          id: string
          property_id: string
          status: string
          updated_at: string
        }
        Insert: {
          bg_color?: string | null
          created_at?: string
          fg_color?: string | null
          id?: string
          property_id: string
          status: string
          updated_at?: string
        }
        Update: {
          bg_color?: string | null
          created_at?: string
          fg_color?: string | null
          id?: string
          property_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_status_color_settings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          category_id: string | null
          created_at: string
          floor: string | null
          housekeeping_status: Database["public"]["Enums"]["housekeeping_status"]
          id: string
          is_active: boolean
          notes: string | null
          property_id: string
          room_number: string
          status: Database["public"]["Enums"]["room_status"]
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          floor?: string | null
          housekeeping_status?: Database["public"]["Enums"]["housekeeping_status"]
          id?: string
          is_active?: boolean
          notes?: string | null
          property_id: string
          room_number: string
          status?: Database["public"]["Enums"]["room_status"]
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          floor?: string | null
          housekeeping_status?: Database["public"]["Enums"]["housekeeping_status"]
          id?: string
          is_active?: boolean
          notes?: string | null
          property_id?: string
          room_number?: string
          status?: Database["public"]["Enums"]["room_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "room_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      segment_bill_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          gst_amount: number
          gst_rate: number
          id: string
          note: string | null
          qty: number
          rate: number
          segment_bill_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          gst_amount?: number
          gst_rate?: number
          id?: string
          note?: string | null
          qty?: number
          rate?: number
          segment_bill_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          gst_amount?: number
          gst_rate?: number
          id?: string
          note?: string | null
          qty?: number
          rate?: number
          segment_bill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_bill_items_segment_bill_id_fkey"
            columns: ["segment_bill_id"]
            isOneToOne: false
            referencedRelation: "segment_bills"
            referencedColumns: ["id"]
          },
        ]
      }
      segment_bills: {
        Row: {
          bill_number: string
          booking_id: string | null
          created_at: string
          created_by: string | null
          event_booking_id: string | null
          folio_id: string | null
          gst_amount: number
          guest_id: string | null
          guest_name: string | null
          id: string
          is_walkin: boolean
          notes: string | null
          paid_amount: number
          payment_mode: string | null
          property_id: string
          room_id: string | null
          segment: string
          settled_at: string | null
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          bill_number: string
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          event_booking_id?: string | null
          folio_id?: string | null
          gst_amount?: number
          guest_id?: string | null
          guest_name?: string | null
          id?: string
          is_walkin?: boolean
          notes?: string | null
          paid_amount?: number
          payment_mode?: string | null
          property_id: string
          room_id?: string | null
          segment: string
          settled_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          bill_number?: string
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          event_booking_id?: string | null
          folio_id?: string | null
          gst_amount?: number
          guest_id?: string | null
          guest_name?: string | null
          id?: string
          is_walkin?: boolean
          notes?: string | null
          paid_amount?: number
          payment_mode?: string | null
          property_id?: string
          room_id?: string | null
          segment?: string
          settled_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_bills_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "segment_bills_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_bills_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "segment_bills_event_booking_id_fkey"
            columns: ["event_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_bills_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_bills_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "receivables_aging"
            referencedColumns: ["folio_id"]
          },
          {
            foreignKeyName: "segment_bills_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_bills_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_bills_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_handover_lines: {
        Row: {
          created_at: string
          difference: number
          handover_id: string
          id: string
          manual_entry: number
          mode: string
          note: string | null
          system_total: number
        }
        Insert: {
          created_at?: string
          difference?: number
          handover_id: string
          id?: string
          manual_entry?: number
          mode: string
          note?: string | null
          system_total?: number
        }
        Update: {
          created_at?: string
          difference?: number
          handover_id?: string
          id?: string
          manual_entry?: number
          mode?: string
          note?: string | null
          system_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "shift_handover_lines_handover_id_fkey"
            columns: ["handover_id"]
            isOneToOne: false
            referencedRelation: "shift_handovers"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_handovers: {
        Row: {
          closing_cash: number | null
          created_at: string
          id: string
          incoming_user_id: string | null
          incoming_user_name: string | null
          notes: string | null
          opening_cash: number | null
          outgoing_user_id: string
          outgoing_user_name: string
          property_id: string
          total_difference: number
          total_manual: number
          total_system: number
          updated_at: string
          window_end: string
          window_start: string
        }
        Insert: {
          closing_cash?: number | null
          created_at?: string
          id?: string
          incoming_user_id?: string | null
          incoming_user_name?: string | null
          notes?: string | null
          opening_cash?: number | null
          outgoing_user_id: string
          outgoing_user_name: string
          property_id: string
          total_difference?: number
          total_manual?: number
          total_system?: number
          updated_at?: string
          window_end?: string
          window_start: string
        }
        Update: {
          closing_cash?: number | null
          created_at?: string
          id?: string
          incoming_user_id?: string | null
          incoming_user_name?: string | null
          notes?: string | null
          opening_cash?: number | null
          outgoing_user_id?: string
          outgoing_user_name?: string
          property_id?: string
          total_difference?: number
          total_manual?: number
          total_system?: number
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_handovers_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          address: string | null
          created_at: string
          department: string | null
          designation: string | null
          email: string | null
          id: string
          id_proof: string | null
          is_active: boolean
          joining_date: string | null
          mobile: string | null
          name: string
          photo_url: string | null
          property_id: string
          salary: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          email?: string | null
          id?: string
          id_proof?: string | null
          is_active?: boolean
          joining_date?: string | null
          mobile?: string | null
          name: string
          photo_url?: string | null
          property_id: string
          salary?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          email?: string | null
          id?: string
          id_proof?: string | null
          is_active?: boolean
          joining_date?: string | null
          mobile?: string | null
          name?: string
          photo_url?: string | null
          property_id?: string
          salary?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          department: string | null
          id: string
          item_id: string
          movement_date: string
          movement_type: string
          property_id: string
          quantity: number
          rate: number
          reason: string | null
          reference: string | null
          vendor_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          created_by?: string | null
          department?: string | null
          id?: string
          item_id: string
          movement_date?: string
          movement_type: string
          property_id: string
          quantity: number
          rate?: number
          reason?: string | null
          reference?: string | null
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          department?: string | null
          id?: string
          item_id?: string
          movement_date?: string
          movement_type?: string
          property_id?: string
          quantity?: number
          rate?: number
          reason?: string | null
          reference?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      sundry_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          property_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          property_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sundry_categories_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      sundry_items: {
        Row: {
          category: string
          category_id: string
          created_at: string
          gst_rate: number
          id: string
          is_active: boolean
          name: string
          property_id: string
          rate: number
          short_code: string | null
          sku: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          category: string
          category_id: string
          created_at?: string
          gst_rate?: number
          id?: string
          is_active?: boolean
          name: string
          property_id: string
          rate?: number
          short_code?: string | null
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string
          category_id?: string
          created_at?: string
          gst_rate?: number
          id?: string
          is_active?: boolean
          name?: string
          property_id?: string
          rate?: number
          short_code?: string | null
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sundry_items_category_property_fkey"
            columns: ["category_id", "property_id"]
            isOneToOne: false
            referencedRelation: "sundry_categories"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "sundry_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          message: string | null
          payload: Json | null
          property_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          message?: string | null
          payload?: Json | null
          property_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          message?: string | null
          payload?: Json | null
          property_id?: string | null
        }
        Relationships: []
      }
      tariff_plans: {
        Row: {
          category_id: string | null
          complimentary_food_limit_per_person: number
          created_at: string
          extra_adult_rate: number
          extra_child_rate: number
          id: string
          is_active: boolean
          is_default: boolean
          meal_plan: Database["public"]["Enums"]["meal_plan"]
          name: string
          plan_type: string | null
          property_id: string
          rate: number
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          category_id?: string | null
          complimentary_food_limit_per_person?: number
          created_at?: string
          extra_adult_rate?: number
          extra_child_rate?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          meal_plan?: Database["public"]["Enums"]["meal_plan"]
          name: string
          plan_type?: string | null
          property_id: string
          rate?: number
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          category_id?: string | null
          complimentary_food_limit_per_person?: number
          created_at?: string
          extra_adult_rate?: number
          extra_child_rate?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          meal_plan?: Database["public"]["Enums"]["meal_plan"]
          name?: string
          plan_type?: string | null
          property_id?: string
          rate?: number
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tariff_plans_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "room_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_plans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      user_mfa_settings: {
        Row: {
          created_at: string
          enabled: boolean
          enrolled_at: string | null
          factor_type: string
          last_used_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          enrolled_at?: string | null
          factor_type?: string
          last_used_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          enrolled_at?: string | null
          factor_type?: string
          last_used_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          property_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          role_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          role_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          role_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_totp_secrets: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          failed_attempts: number
          id: string
          last_verified_at: string | null
          locked_until: string | null
          secret_encrypted: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          failed_attempts?: number
          id?: string
          last_verified_at?: string | null
          locked_until?: string | null
          secret_encrypted: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          failed_attempts?: number
          id?: string
          last_verified_at?: string | null
          locked_until?: string | null
          secret_encrypted?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          email: string | null
          gstin: string | null
          id: string
          is_active: boolean
          mobile: string | null
          name: string
          property_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          mobile?: string | null
          name: string
          property_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          mobile?: string | null
          name?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          booking_id: string | null
          campaign_name: string | null
          category: string | null
          content: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          direction: string
          error_message: string | null
          external_id: string | null
          guest_id: string | null
          id: string
          media_url: string | null
          property_id: string
          read_at: string | null
          sent_at: string | null
          status: string
          template_name: string | null
          updated_at: string
          wa_number: string
        }
        Insert: {
          booking_id?: string | null
          campaign_name?: string | null
          category?: string | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          direction: string
          error_message?: string | null
          external_id?: string | null
          guest_id?: string | null
          id?: string
          media_url?: string | null
          property_id: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
          wa_number: string
        }
        Update: {
          booking_id?: string | null
          campaign_name?: string | null
          category?: string | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          external_id?: string | null
          guest_id?: string | null
          id?: string
          media_url?: string | null
          property_id?: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
          wa_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "whatsapp_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      wipe_logs: {
        Row: {
          created_at: string
          date_from: string
          date_to: string
          id: string
          initiated_by: string | null
          is_restored: boolean
          percentage: number
          property_id: string | null
          record_count: number
          restored_at: string | null
          restored_by: string | null
          tables_selected: string[]
          wiped_at: string
        }
        Insert: {
          created_at?: string
          date_from: string
          date_to: string
          id?: string
          initiated_by?: string | null
          is_restored?: boolean
          percentage?: number
          property_id?: string | null
          record_count?: number
          restored_at?: string | null
          restored_by?: string | null
          tables_selected?: string[]
          wiped_at?: string
        }
        Update: {
          created_at?: string
          date_from?: string
          date_to?: string
          id?: string
          initiated_by?: string | null
          is_restored?: boolean
          percentage?: number
          property_id?: string | null
          record_count?: number
          restored_at?: string | null
          restored_by?: string | null
          tables_selected?: string[]
          wiped_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wipe_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      wiped_data_archive: {
        Row: {
          id: string
          original_data: Json
          record_id: string
          table_name: string
          wipe_log_id: string
          wiped_at: string
        }
        Insert: {
          id?: string
          original_data: Json
          record_id: string
          table_name: string
          wipe_log_id: string
          wiped_at?: string
        }
        Update: {
          id?: string
          original_data?: Json
          record_id?: string
          table_name?: string
          wipe_log_id?: string
          wiped_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wiped_data_archive_wipe_log_id_fkey"
            columns: ["wipe_log_id"]
            isOneToOne: false
            referencedRelation: "wipe_logs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      booking_financials: {
        Row: {
          advance_amount: number | null
          balance_amount: number | null
          booking_id: string | null
          booking_type: string | null
          folio_total: number | null
          property_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      receivables_aging: {
        Row: {
          amount_transferred: number | null
          authorized_by: string | null
          balance_amount: number | null
          booking_id: string | null
          days_overdue: number | null
          folio_id: string | null
          guest_id: string | null
          guest_mobile: string | null
          guest_name: string | null
          invoice_number: string | null
          paid_amount: number | null
          property_id: string | null
          since_at: string | null
          status: string | null
          total_amount: number | null
          transfer_reason: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folios_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "booking_financials"
            referencedColumns: ["booking_id"]
          },
          {
            foreignKeyName: "folios_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folios_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auto_cancel_incomplete_bookings: { Args: never; Returns: number }
      auto_close_segment_bills: { Args: never; Returns: number }
      available_rooms: {
        Args: {
          _category_id?: string
          _check_in: string
          _check_out: string
          _property_id: string
        }
        Returns: {
          category_id: string
          floor: string
          id: string
          room_number: string
          status: string
        }[]
      }
      banquet_visibility: {
        Args: { _property_id?: string }
        Returns: {
          booking_id: string
          event_id: string
          expired: boolean
          expires_at: string
          last_checkout_at: string
        }[]
      }
      bill_number_prefix: {
        Args: { _property_id: string; _segment: string }
        Returns: string
      }
      can_billing: {
        Args: { _property_id: string; _user_id: string }
        Returns: boolean
      }
      can_food: {
        Args: { _property_id: string; _user_id: string }
        Returns: boolean
      }
      can_front_desk: {
        Args: { _property_id: string; _user_id: string }
        Returns: boolean
      }
      can_housekeeping: {
        Args: { _property_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_masters: {
        Args: { _property_id: string; _user_id: string }
        Returns: boolean
      }
      check_login_allowed: { Args: { _email: string }; Returns: Json }
      create_booking: { Args: { payload: Json }; Returns: Json }
      create_event_booking: { Args: { payload: Json }; Returns: Json }
      current_user_max_discount_pct: {
        Args: { _property_id: string }
        Returns: number
      }
      current_user_totp_required: { Args: never; Returns: boolean }
      dashboard_grid: {
        Args: { _date: string; _include_kots?: boolean; _property_id: string }
        Returns: Json
      }
      delete_night_audit: { Args: { _id: string }; Returns: undefined }
      delete_shift_handover: {
        Args: { _id: string; _reason: string }
        Returns: Json
      }
      ensure_billing_company: {
        Args: { _company_id?: string; _payload: Json; _property_id: string }
        Returns: string
      }
      event_gst_rate: {
        Args: { _amount: number; _property_id: string }
        Returns: number
      }
      generate_bill_number: {
        Args: { _property_id: string; _segment: string }
        Returns: string
      }
      generate_system_reminders: { Args: never; Returns: number }
      get_early_checkin_charge: {
        Args: { p_hours_early: number; p_property_id: string }
        Returns: number
      }
      get_gst_rate: {
        Args: { p_amount: number; p_category: string; p_property_id: string }
        Returns: number
      }
      get_next_bill_number: {
        Args: { p_property_id: string; p_type: string }
        Returns: string
      }
      get_or_create_folio: { Args: { _booking_id: string }; Returns: string }
      get_property_secrets: {
        Args: { _property_id: string }
        Returns: {
          aisensy_api_key: string
          wa_number: string
          wifi_password: string
        }[]
      }
      gst_state_code_from_gstin: { Args: { _gstin: string }; Returns: string }
      gst_state_code_from_name: { Args: { _name: string }; Returns: string }
      has_open_kot: { Args: { _booking_id: string }; Returns: boolean }
      has_pending_segment_bills: {
        Args: { _booking_id: string }
        Returns: {
          balance: number
          bill_number: string
          id: string
          paid_amount: number
          segment: string
          total_amount: number
        }[]
      }
      has_permission: {
        Args: {
          _action: string
          _module: string
          _property_id: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_conforming_bill_number: {
        Args: { _prefix: string; _value: string }
        Returns: boolean
      }
      is_day_locked: {
        Args: { _d: string; _property_id: string }
        Returns: boolean
      }
      is_global_owner: { Args: { _user_id: string }; Returns: boolean }
      is_owner_or_super: { Args: { _user_id: string }; Returns: boolean }
      is_superadmin: { Args: { _uid: string }; Returns: boolean }
      last_handover_window_start: {
        Args: { _property_id: string }
        Returns: string
      }
      list_property_staff: {
        Args: { _property_id: string }
        Returns: {
          display_name: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      log_auth_event: {
        Args: {
          _event_type: string
          _ip?: string
          _metadata?: Json
          _user_agent?: string
        }
        Returns: string
      }
      log_owner_override: {
        Args: {
          _action: string
          _new: Json
          _old: Json
          _property_id: string
          _reason: string
          _record_id: string
          _table_name: string
        }
        Returns: string
      }
      owner_update_bill_item: {
        Args: {
          _description: string
          _gst_rate: number
          _item_id: string
          _qty: number
          _rate: number
          _reason: string
        }
        Returns: Json
      }
      owner_update_folio_charge: {
        Args: {
          _charge_id: string
          _description: string
          _gst_rate: number
          _qty: number
          _rate: number
          _reason: string
        }
        Returns: Json
      }
      owner_update_folio_header: {
        Args: {
          _folio_id: string
          _guest_company: string
          _guest_gstin: string
          _notes: string
          _reason: string
        }
        Returns: Json
      }
      owner_void_banquet_document: {
        Args: { _id: string; _kind: string; _reason: string }
        Returns: Json
      }
      permitted_property_ids: {
        Args: { _action: string; _module: string; _user_id: string }
        Returns: string[]
      }
      post_nightly_room_charges: {
        Args: { _audit_date: string; _property_id: string }
        Returns: number
      }
      recompute_folio_totals: {
        Args: { _folio_id: string }
        Returns: undefined
      }
      record_login_attempt: {
        Args: {
          _email: string
          _ip?: string
          _reason?: string
          _success: boolean
          _user_agent?: string
        }
        Returns: Json
      }
      resolve_event_ids: { Args: { _id: string }; Returns: Json }
      room_gst_rate_for_tariff: { Args: { _rate: number }; Returns: number }
      save_property_secrets: {
        Args: {
          _aisensy_api_key: string
          _property_id: string
          _wa_number: string
          _wifi_password: string
        }
        Returns: undefined
      }
      seed_event_folio_charges: {
        Args: { _booking_id: string }
        Returns: string
      }
      seed_extra_bed_charge: { Args: { _beb_id: string }; Returns: string }
      seed_room_charge_for_booking_room: {
        Args: { _booking_room_id: string }
        Returns: string
      }
      settle_segment_bill: {
        Args: { _actor?: string; _auto?: boolean; _bill_id: string }
        Returns: Json
      }
      shift_room: {
        Args: {
          _booking_room_id: string
          _new_rate: number
          _reason: string
          _shifted_by: string
          _tariff_choice: string
          _to_room_id: string
        }
        Returns: string
      }
      split_room_night: {
        Args: { _booking_room_id: string; _new_rate: number; _night: string }
        Returns: string
      }
      sync_booking_balance: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      sync_event_block_booking_room: {
        Args: { _block_id: string }
        Returns: string
      }
      undo_checkout: { Args: { _booking_id: string }; Returns: Json }
      update_booking_safe_fields: { Args: { payload: Json }; Returns: Json }
      user_discount_limit: {
        Args: { _property_id: string; _user_id: string }
        Returns: {
          limit_type: string
          limit_value: number
          unlimited: boolean
        }[]
      }
      user_has_permission: {
        Args: {
          _action: string
          _module: string
          _property_id: string
          _user_id: string
        }
        Returns: boolean
      }
      user_has_property: {
        Args: { _prop: string; _uid: string }
        Returns: boolean
      }
      user_max_discount_pct: {
        Args: { _property_id: string; _user_id: string }
        Returns: number
      }
      user_property_ids: { Args: { _uid: string }; Returns: string[] }
      void_folio_safe: {
        Args: {
          _folio_id: string
          _force?: boolean
          _reason: string
          _user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "superadmin"
        | "owner"
        | "manager"
        | "receptionist"
        | "housekeeping"
        | "kitchen"
      booking_status:
        | "reserved"
        | "checked_in"
        | "checked_out"
        | "cancelled"
        | "no_show"
      housekeeping_status: "clean" | "dirty" | "inspected" | "out_of_order"
      kot_type: "kitchen" | "bar" | "both"
      meal_plan: "EP" | "CP" | "MAP" | "AP"
      petty_cash_entry_type: "opening" | "in" | "out"
      printer_type: "kot" | "bill" | "both"
      room_status: "vacant" | "occupied" | "blocked" | "maintenance"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "superadmin",
        "owner",
        "manager",
        "receptionist",
        "housekeeping",
        "kitchen",
      ],
      booking_status: [
        "reserved",
        "checked_in",
        "checked_out",
        "cancelled",
        "no_show",
      ],
      housekeeping_status: ["clean", "dirty", "inspected", "out_of_order"],
      kot_type: ["kitchen", "bar", "both"],
      meal_plan: ["EP", "CP", "MAP", "AP"],
      petty_cash_entry_type: ["opening", "in", "out"],
      printer_type: ["kot", "bill", "both"],
      room_status: ["vacant", "occupied", "blocked", "maintenance"],
    },
  },
} as const
