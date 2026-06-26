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
      banquet_bookings: {
        Row: {
          advance_amount: number
          advance_payment_mode: string | null
          balance_amount: number
          banquet_number: string
          bill_type: string
          cancelled_at: string | null
          cancelled_reason: string | null
          created_at: string
          created_by: string | null
          discount_amount: number
          end_time: string
          event_bill_id: string | null
          event_date: string
          event_name: string | null
          extra_charge: number
          extra_charge_description: string | null
          fb_charge: number
          function_type: string
          guest_id: string | null
          hall_charge: number
          hall_id: string
          id: string
          notes: string | null
          package_rate: number
          pax: number
          property_id: string
          start_time: string
          status: string
          total_amount: number
          total_room_charges: number
          updated_at: string
        }
        Insert: {
          advance_amount?: number
          advance_payment_mode?: string | null
          balance_amount?: number
          banquet_number?: string
          bill_type?: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          end_time: string
          event_bill_id?: string | null
          event_date: string
          event_name?: string | null
          extra_charge?: number
          extra_charge_description?: string | null
          fb_charge?: number
          function_type?: string
          guest_id?: string | null
          hall_charge?: number
          hall_id: string
          id?: string
          notes?: string | null
          package_rate?: number
          pax?: number
          property_id: string
          start_time: string
          status?: string
          total_amount?: number
          total_room_charges?: number
          updated_at?: string
        }
        Update: {
          advance_amount?: number
          advance_payment_mode?: string | null
          balance_amount?: number
          banquet_number?: string
          bill_type?: string
          cancelled_at?: string | null
          cancelled_reason?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          end_time?: string
          event_bill_id?: string | null
          event_date?: string
          event_name?: string | null
          extra_charge?: number
          extra_charge_description?: string | null
          fb_charge?: number
          function_type?: string
          guest_id?: string | null
          hall_charge?: number
          hall_id?: string
          id?: string
          notes?: string | null
          package_rate?: number
          pax?: number
          property_id?: string
          start_time?: string
          status?: string
          total_amount?: number
          total_room_charges?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "banquet_bookings_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banquet_bookings_hall_id_fkey"
            columns: ["hall_id"]
            isOneToOne: false
            referencedRelation: "halls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banquet_bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      banquet_bulk_rooms: {
        Row: {
          banquet_id: string
          category_id: string | null
          check_in: string
          check_out: string
          created_at: string
          id: string
          nights: number
          rate: number
          room_id: string | null
        }
        Insert: {
          banquet_id: string
          category_id?: string | null
          check_in: string
          check_out: string
          created_at?: string
          id?: string
          nights?: number
          rate?: number
          room_id?: string | null
        }
        Update: {
          banquet_id?: string
          category_id?: string | null
          check_in?: string
          check_out?: string
          created_at?: string
          id?: string
          nights?: number
          rate?: number
          room_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "banquet_bulk_rooms_banquet_id_fkey"
            columns: ["banquet_id"]
            isOneToOne: false
            referencedRelation: "banquet_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banquet_bulk_rooms_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "room_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banquet_bulk_rooms_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
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
          check_out: string
          children: number
          created_at: string
          end_date: string | null
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
          check_out: string
          children?: number
          created_at?: string
          end_date?: string | null
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
          check_out?: string
          children?: number
          created_at?: string
          end_date?: string | null
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
          balance_amount: number
          booking_number: string
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
          event_id: string | null
          guest_id: string | null
          id: string
          is_wiped: boolean
          notes: string | null
          property_id: string
          restaurant_ledger_balance: number
          source: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          updated_at: string
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          adults?: number
          advance_amount?: number
          balance_amount?: number
          booking_number: string
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
          event_id?: string | null
          guest_id?: string | null
          id?: string
          is_wiped?: boolean
          notes?: string | null
          property_id: string
          restaurant_ledger_balance?: number
          source?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          updated_at?: string
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          adults?: number
          advance_amount?: number
          balance_amount?: number
          booking_number?: string
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
          event_id?: string | null
          guest_id?: string | null
          id?: string
          is_wiped?: boolean
          notes?: string | null
          property_id?: string
          restaurant_ledger_balance?: number
          source?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          updated_at?: string
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "banquet_bookings"
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
          approved_by: string | null
          approver_email: string | null
          booking_id: string
          created_at: string
          folio_id: string | null
          id: string
          pending_amount: number | null
          pending_kot_ids: string[] | null
          property_id: string
          reason: string
          requested_by: string | null
        }
        Insert: {
          approved_by?: string | null
          approver_email?: string | null
          booking_id: string
          created_at?: string
          folio_id?: string | null
          id?: string
          pending_amount?: number | null
          pending_kot_ids?: string[] | null
          property_id: string
          reason: string
          requested_by?: string | null
        }
        Update: {
          approved_by?: string | null
          approver_email?: string | null
          booking_id?: string
          created_at?: string
          folio_id?: string | null
          id?: string
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
            foreignKeyName: "checkout_overrides_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
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
      event_room_blocks: {
        Row: {
          banquet_booking_id: string
          booking_id: string | null
          checked_in_at: string | null
          checked_in_by: string | null
          checked_out_at: string | null
          checked_out_by: string | null
          checkin_date: string
          checkout_date: string
          created_at: string
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
          banquet_booking_id: string
          booking_id?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          checkin_date: string
          checkout_date: string
          created_at?: string
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
          banquet_booking_id?: string
          booking_id?: string | null
          checked_in_at?: string | null
          checked_in_by?: string | null
          checked_out_at?: string | null
          checked_out_by?: string | null
          checkin_date?: string
          checkout_date?: string
          created_at?: string
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
            foreignKeyName: "event_room_blocks_banquet_booking_id_fkey"
            columns: ["banquet_booking_id"]
            isOneToOne: false
            referencedRelation: "banquet_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_room_blocks_booking_id_fkey"
            columns: ["booking_id"]
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
          id: string
          is_wiped: boolean
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
          id?: string
          is_wiped?: boolean
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
          id?: string
          is_wiped?: boolean
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
          folio_id: string
          gst_amount: number
          gst_rate: number
          hsn_code: string | null
          id: string
          is_wiped: boolean
          qty: number
          rate: number
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
          folio_id: string
          gst_amount?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_wiped?: boolean
          qty?: number
          rate?: number
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
          folio_id?: string
          gst_amount?: number
          gst_rate?: number
          hsn_code?: string | null
          id?: string
          is_wiped?: boolean
          qty?: number
          rate?: number
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
          booking_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          discount_amount: number
          gst_amount: number
          gst_mode: string
          guest_company: string | null
          guest_gstin: string | null
          id: string
          invoice_number: string
          is_deleted: boolean
          notes: string | null
          paid_amount: number
          property_id: string
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
          booking_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount_amount?: number
          gst_amount?: number
          gst_mode?: string
          guest_company?: string | null
          guest_gstin?: string | null
          id?: string
          invoice_number?: string
          is_deleted?: boolean
          notes?: string | null
          paid_amount?: number
          property_id: string
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
          booking_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          discount_amount?: number
          gst_amount?: number
          gst_mode?: string
          guest_company?: string | null
          guest_gstin?: string | null
          id?: string
          invoice_number?: string
          is_deleted?: boolean
          notes?: string | null
          paid_amount?: number
          property_id?: string
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
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
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
          id: string
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
          id?: string
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
          id?: string
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
          wipe_log_id: string | null
          wiped_at: string | null
        }
        Insert: {
          billed_at?: string | null
          booking_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
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
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Update: {
          billed_at?: string | null
          booking_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
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
          wipe_log_id?: string | null
          wiped_at?: string | null
        }
        Relationships: [
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
      menu_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
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
          kot_type?: Database["public"]["Enums"]["kot_type"]
          name?: string
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
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
          kitchen_type: string
          kot_station: string
          name: string
          price: number
          property_id: string
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
          kitchen_type?: string
          kot_station?: string
          name: string
          price?: number
          property_id: string
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
          kitchen_type?: string
          kot_station?: string
          name?: string
          price?: number
          property_id?: string
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
      mis_accounts: {
        Row: {
          created_at: string
          id: string
          name: string | null
          property_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          property_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mis_accounts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      mis_ledger: {
        Row: {
          amount: number
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          is_deleted: boolean
          line_items: Json
          mis_account_id: string | null
          property_id: string
          shifted_at: string
          shifted_by: string | null
          shifted_by_name: string | null
          source_bill_id: string | null
          source_bill_number: string | null
          source_booking_id: string | null
          source_guest_id: string | null
          source_guest_name: string | null
          source_room_number: string | null
        }
        Insert: {
          amount: number
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_deleted?: boolean
          line_items?: Json
          mis_account_id?: string | null
          property_id: string
          shifted_at?: string
          shifted_by?: string | null
          shifted_by_name?: string | null
          source_bill_id?: string | null
          source_bill_number?: string | null
          source_booking_id?: string | null
          source_guest_id?: string | null
          source_guest_name?: string | null
          source_room_number?: string | null
        }
        Update: {
          amount?: number
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          is_deleted?: boolean
          line_items?: Json
          mis_account_id?: string | null
          property_id?: string
          shifted_at?: string
          shifted_by?: string | null
          shifted_by_name?: string | null
          source_bill_id?: string | null
          source_bill_number?: string | null
          source_booking_id?: string | null
          source_guest_id?: string | null
          source_guest_name?: string | null
          source_room_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mis_ledger_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mis_ledger_mis_account_id_fkey"
            columns: ["mis_account_id"]
            isOneToOne: false
            referencedRelation: "mis_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mis_ledger_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mis_ledger_shifted_by_fkey"
            columns: ["shifted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mis_ledger_source_booking_id_fkey"
            columns: ["source_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mis_ledger_source_guest_id_fkey"
            columns: ["source_guest_id"]
            isOneToOne: false
            referencedRelation: "guests"
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
      printers: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          is_active: boolean
          is_default: boolean
          location: string | null
          name: string
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
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          is_active?: boolean
          mobile?: string | null
          name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          mobile?: string | null
          name?: string | null
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
          checkout_time: string | null
          city: string | null
          created_at: string
          currency: string | null
          default_bill_type: string | null
          default_checkin_time: string | null
          default_checkout_time: string | null
          early_checkin_charge: number | null
          early_checkin_charge_per_hour: number | null
          email: string | null
          fiscal_year_start: string | null
          fssai: string | null
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
          short_code: string | null
          star_rating: number | null
          state: string | null
          state_code: string | null
          status: string
          total_floors: number | null
          total_rooms: number | null
          updated_at: string
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
          checkout_time?: string | null
          city?: string | null
          created_at?: string
          currency?: string | null
          default_bill_type?: string | null
          default_checkin_time?: string | null
          default_checkout_time?: string | null
          early_checkin_charge?: number | null
          early_checkin_charge_per_hour?: number | null
          email?: string | null
          fiscal_year_start?: string | null
          fssai?: string | null
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
          short_code?: string | null
          star_rating?: number | null
          state?: string | null
          state_code?: string | null
          status?: string
          total_floors?: number | null
          total_rooms?: number | null
          updated_at?: string
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
          checkout_time?: string | null
          city?: string | null
          created_at?: string
          currency?: string | null
          default_bill_type?: string | null
          default_checkin_time?: string | null
          default_checkout_time?: string | null
          early_checkin_charge?: number | null
          early_checkin_charge_per_hour?: number | null
          email?: string | null
          fiscal_year_start?: string | null
          fssai?: string | null
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
          short_code?: string | null
          star_rating?: number | null
          state?: string | null
          state_code?: string | null
          status?: string
          total_floors?: number | null
          total_rooms?: number | null
          updated_at?: string
          wa_number?: string | null
          website?: string | null
          wifi_password?: string | null
        }
        Relationships: []
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
          created_at: string
          created_by: string | null
          id: string
          is_dismissed: boolean
          notes: string | null
          property_id: string
          reminder_datetime: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_dismissed?: boolean
          notes?: string | null
          property_id: string
          reminder_datetime: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_dismissed?: boolean
          notes?: string | null
          property_id?: string
          reminder_datetime?: string
          title?: string
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
          booking_id: string | null
          charge_date: string
          created_at: string
          description: string | null
          folio_charge_id: string | null
          guest_id: string | null
          id: string
          is_settled: boolean
          posted_by: string | null
          property_id: string
          settled_at: string | null
          settled_by: string | null
        }
        Insert: {
          amount: number
          booking_id?: string | null
          charge_date?: string
          created_at?: string
          description?: string | null
          folio_charge_id?: string | null
          guest_id?: string | null
          id?: string
          is_settled?: boolean
          posted_by?: string | null
          property_id: string
          settled_at?: string | null
          settled_by?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string | null
          charge_date?: string
          created_at?: string
          description?: string | null
          folio_charge_id?: string | null
          guest_id?: string | null
          id?: string
          is_settled?: boolean
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
      restaurant_payables: {
        Row: {
          amount: number
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
          description: string | null
          id: string
          is_system: boolean
          max_discount_pct: number
          name: string
          property_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          max_discount_pct?: number
          name: string
          property_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          max_discount_pct?: number
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
      sundry_items: {
        Row: {
          category: string
          created_at: string
          gst_rate: number
          id: string
          is_active: boolean
          name: string
          property_id: string
          rate: number
          sku: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          gst_rate?: number
          id?: string
          is_active?: boolean
          name: string
          property_id: string
          rate?: number
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          gst_rate?: number
          id?: string
          is_active?: boolean
          name?: string
          property_id?: string
          rate?: number
          sku?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
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
          created_at: string
          extra_adult_rate: number
          extra_child_rate: number
          id: string
          is_active: boolean
          is_default: boolean
          meal_plan: Database["public"]["Enums"]["meal_plan"]
          name: string
          property_id: string
          rate: number
          updated_at: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          extra_adult_rate?: number
          extra_child_rate?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          meal_plan?: Database["public"]["Enums"]["meal_plan"]
          name: string
          property_id: string
          rate?: number
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          extra_adult_rate?: number
          extra_child_rate?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          meal_plan?: Database["public"]["Enums"]["meal_plan"]
          name?: string
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
      [_ in never]: never
    }
    Functions: {
      auto_cancel_incomplete_bookings: { Args: never; Returns: number }
      can_billing: { Args: { _user_id: string }; Returns: boolean }
      can_food: { Args: { _user_id: string }; Returns: boolean }
      can_front_desk: { Args: { _user_id: string }; Returns: boolean }
      can_housekeeping: { Args: { _user_id: string }; Returns: boolean }
      can_manage_masters: { Args: { _user_id: string }; Returns: boolean }
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
      has_open_kot: { Args: { _booking_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_day_locked: {
        Args: { _d: string; _property_id: string }
        Returns: boolean
      }
      is_owner_or_super: { Args: { _user_id: string }; Returns: boolean }
      is_superadmin: { Args: { _uid: string }; Returns: boolean }
      save_property_secrets: {
        Args: {
          _aisensy_api_key: string
          _property_id: string
          _wa_number: string
          _wifi_password: string
        }
        Returns: undefined
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
      printer_type: ["kot", "bill", "both"],
      room_status: ["vacant", "occupied", "blocked", "maintenance"],
    },
  },
} as const
