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
          extra_beds: number
          id: string
          meal_plan: Database["public"]["Enums"]["meal_plan"]
          property_id: string
          rate: number
          room_id: string | null
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
          extra_beds?: number
          id?: string
          meal_plan?: Database["public"]["Enums"]["meal_plan"]
          property_id: string
          rate?: number
          room_id?: string | null
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
          extra_beds?: number
          id?: string
          meal_plan?: Database["public"]["Enums"]["meal_plan"]
          property_id?: string
          rate?: number
          room_id?: string | null
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
          guest_id: string | null
          id: string
          notes: string | null
          property_id: string
          source: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          updated_at: string
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
          guest_id?: string | null
          id?: string
          notes?: string | null
          property_id: string
          source?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          updated_at?: string
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
          guest_id?: string | null
          id?: string
          notes?: string | null
          property_id?: string
          source?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          updated_at?: string
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
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
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
          id: string
          qty: number
          rate: number
          source_id: string | null
          source_table: string | null
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
          id?: string
          qty?: number
          rate?: number
          source_id?: string | null
          source_table?: string | null
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
          id?: string
          qty?: number
          rate?: number
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folio_charges_folio_id_fkey"
            columns: ["folio_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id"]
          },
        ]
      }
      folios: {
        Row: {
          balance_amount: number
          booking_id: string
          created_at: string
          created_by: string | null
          discount_amount: number
          gst_amount: number
          gst_mode: string
          guest_company: string | null
          guest_gstin: string | null
          id: string
          invoice_number: string
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
          booking_id: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          gst_amount?: number
          gst_mode?: string
          guest_company?: string | null
          guest_gstin?: string | null
          id?: string
          invoice_number?: string
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
          booking_id?: string
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          gst_amount?: number
          gst_mode?: string
          guest_company?: string | null
          guest_gstin?: string | null
          id?: string
          invoice_number?: string
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
            isOneToOne: true
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
      guests: {
        Row: {
          address: string | null
          city: string | null
          company: string | null
          country: string | null
          created_at: string
          dob: string | null
          email: string | null
          gender: string | null
          gst_number: string | null
          id: string
          id_proof_number: string | null
          id_proof_type: string | null
          is_blacklisted: boolean
          mobile: string | null
          name: string
          nationality: string | null
          notes: string | null
          photo_url: string | null
          pincode: string | null
          property_id: string
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          dob?: string | null
          email?: string | null
          gender?: string | null
          gst_number?: string | null
          id?: string
          id_proof_number?: string | null
          id_proof_type?: string | null
          is_blacklisted?: boolean
          mobile?: string | null
          name: string
          nationality?: string | null
          notes?: string | null
          photo_url?: string | null
          pincode?: string | null
          property_id: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          dob?: string | null
          email?: string | null
          gender?: string | null
          gst_number?: string | null
          id?: string
          id_proof_number?: string | null
          id_proof_type?: string | null
          is_blacklisted?: boolean
          mobile?: string | null
          name?: string
          nationality?: string | null
          notes?: string | null
          photo_url?: string | null
          pincode?: string | null
          property_id?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_property_id_fkey"
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
          item_name: string
          kot_id: string
          kot_station: string
          menu_item_id: string | null
          notes: string | null
          qty: number
          rate: number
        }
        Insert: {
          amount?: number
          created_at?: string
          gst_rate?: number
          id?: string
          is_void?: boolean
          item_name: string
          kot_id: string
          kot_station?: string
          menu_item_id?: string | null
          notes?: string | null
          qty?: number
          rate?: number
        }
        Update: {
          amount?: number
          created_at?: string
          gst_rate?: number
          id?: string
          is_void?: boolean
          item_name?: string
          kot_id?: string
          kot_station?: string
          menu_item_id?: string | null
          notes?: string | null
          qty?: number
          rate?: number
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
        ]
      }
      kot_orders: {
        Row: {
          billed_at: string | null
          booking_id: string | null
          created_at: string
          created_by: string | null
          gst_amount: number
          guest_name: string | null
          id: string
          kot_number: string
          kot_type: string
          notes: string | null
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
        }
        Insert: {
          billed_at?: string | null
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          gst_amount?: number
          guest_name?: string | null
          id?: string
          kot_number?: string
          kot_type?: string
          notes?: string | null
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
        }
        Update: {
          billed_at?: string | null
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          gst_amount?: number
          guest_name?: string | null
          id?: string
          kot_number?: string
          kot_type?: string
          notes?: string | null
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
      payments: {
        Row: {
          amount: number
          booking_id: string | null
          created_at: string
          created_by: string | null
          folio_id: string
          id: string
          mode: string
          notes: string | null
          paid_at: string
          property_id: string
          reference_no: string | null
        }
        Insert: {
          amount: number
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          folio_id: string
          id?: string
          mode: string
          notes?: string | null
          paid_at?: string
          property_id: string
          reference_no?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          folio_id?: string
          id?: string
          mode?: string
          notes?: string | null
          paid_at?: string
          property_id?: string
          reference_no?: string | null
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
          port: number | null
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
          checkin_time: string | null
          checkout_time: string | null
          city: string | null
          created_at: string
          currency: string | null
          early_checkin_charge: number | null
          email: string | null
          fiscal_year_start: string | null
          fssai: string | null
          gstin: string | null
          id: string
          is_active: boolean
          late_checkout_charge: number | null
          logo_url: string | null
          name: string
          pan: string | null
          phone: string | null
          pincode: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          checkin_time?: string | null
          checkout_time?: string | null
          city?: string | null
          created_at?: string
          currency?: string | null
          early_checkin_charge?: number | null
          email?: string | null
          fiscal_year_start?: string | null
          fssai?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          late_checkout_charge?: number | null
          logo_url?: string | null
          name: string
          pan?: string | null
          phone?: string | null
          pincode?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          checkin_time?: string | null
          checkout_time?: string | null
          city?: string | null
          created_at?: string
          currency?: string | null
          early_checkin_charge?: number | null
          email?: string | null
          fiscal_year_start?: string | null
          fssai?: string | null
          gstin?: string | null
          id?: string
          is_active?: boolean
          late_checkout_charge?: number | null
          logo_url?: string | null
          name?: string
          pan?: string | null
          phone?: string | null
          pincode?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      room_categories: {
        Row: {
          base_rate: number
          code: string | null
          created_at: string
          description: string | null
          extra_bed_rate: number
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
          property_id: string
          reason: string | null
          shifted_at: string
          shifted_by: string | null
          to_room_id: string | null
        }
        Insert: {
          booking_room_id: string
          from_room_id?: string | null
          id?: string
          property_id: string
          reason?: string | null
          shifted_at?: string
          shifted_by?: string | null
          to_room_id?: string | null
        }
        Update: {
          booking_room_id?: string
          from_room_id?: string | null
          id?: string
          property_id?: string
          reason?: string | null
          shifted_at?: string
          shifted_by?: string | null
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
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_billing: { Args: { _user_id: string }; Returns: boolean }
      can_food: { Args: { _user_id: string }; Returns: boolean }
      can_front_desk: { Args: { _user_id: string }; Returns: boolean }
      can_manage_masters: { Args: { _user_id: string }; Returns: boolean }
      get_or_create_folio: { Args: { _booking_id: string }; Returns: string }
      has_open_kot: { Args: { _booking_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
