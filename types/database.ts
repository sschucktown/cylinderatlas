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
      admin_users: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      claims: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["claim_status_enum"]
          updated_at: string
          user_id: string
          verification_method: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["claim_status_enum"]
          updated_at?: string
          user_id: string
          verification_method?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["claim_status_enum"]
          updated_at?: string
          user_id?: string
          verification_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          canonical_name: string
          created_at: string
          id: string
          legal_name: string | null
          updated_at: string
          website_domain: string | null
        }
        Insert: {
          canonical_name: string
          created_at?: string
          id?: string
          legal_name?: string | null
          updated_at?: string
          website_domain?: string | null
        }
        Update: {
          canonical_name?: string
          created_at?: string
          id?: string
          legal_name?: string | null
          updated_at?: string
          website_domain?: string | null
        }
        Relationships: []
      }
      corrections: {
        Row: {
          created_at: string
          facility_id: string
          field_name: string
          id: string
          proposed_value: Json
          status: Database["public"]["Enums"]["correction_status_enum"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          facility_id: string
          field_name: string
          id?: string
          proposed_value: Json
          status?: Database["public"]["Enums"]["correction_status_enum"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          facility_id?: string
          field_name?: string
          id?: string
          proposed_value?: Json
          status?: Database["public"]["Enums"]["correction_status_enum"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corrections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_runs: {
        Row: {
          algorithm_version: string
          completed_at: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          sample_size: number | null
          scope: Json
          started_at: string | null
          status: Database["public"]["Enums"]["enrichment_run_status_enum"]
        }
        Insert: {
          algorithm_version: string
          completed_at?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          sample_size?: number | null
          scope?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["enrichment_run_status_enum"]
        }
        Update: {
          algorithm_version?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          sample_size?: number | null
          scope?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["enrichment_run_status_enum"]
        }
        Relationships: []
      }
      evidence: {
        Row: {
          captured_at: string
          evidence_type: Database["public"]["Enums"]["evidence_type_enum"]
          facility_id: string
          id: string
          summary: string
          supports_field: string
          url: string | null
        }
        Insert: {
          captured_at?: string
          evidence_type: Database["public"]["Enums"]["evidence_type_enum"]
          facility_id: string
          id?: string
          summary: string
          supports_field: string
          url?: string | null
        }
        Update: {
          captured_at?: string
          evidence_type?: Database["public"]["Enums"]["evidence_type_enum"]
          facility_id?: string
          id?: string
          summary?: string
          supports_field?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          candidate_type_hint: string | null
          city: string
          commercial_status: Database["public"]["Enums"]["commercial_status_enum"]
          company_id: string | null
          created_at: string
          display_address: string | null
          display_name: string | null
          enrichment_run_id: string | null
          enrichment_version: string | null
          id: string
          identity_confidence: number
          last_enriched_at: string | null
          manual_review_reason: string | null
          phmsa_address: string
          phmsa_name: string
          phone: string | null
          pipeline_status: string
          postal_code: string | null
          publish_status: Database["public"]["Enums"]["publish_status_enum"]
          rin: string
          source_effective_date: string | null
          source_row_count: number
          state: string
          updated_at: string
          verified_at: string | null
          website_url: string | null
        }
        Insert: {
          candidate_type_hint?: string | null
          city: string
          commercial_status?: Database["public"]["Enums"]["commercial_status_enum"]
          company_id?: string | null
          created_at?: string
          display_address?: string | null
          display_name?: string | null
          enrichment_run_id?: string | null
          enrichment_version?: string | null
          id?: string
          identity_confidence?: number
          last_enriched_at?: string | null
          manual_review_reason?: string | null
          phmsa_address: string
          phmsa_name: string
          phone?: string | null
          pipeline_status?: string
          postal_code?: string | null
          publish_status?: Database["public"]["Enums"]["publish_status_enum"]
          rin: string
          source_effective_date?: string | null
          source_row_count?: number
          state: string
          updated_at?: string
          verified_at?: string | null
          website_url?: string | null
        }
        Update: {
          candidate_type_hint?: string | null
          city?: string
          commercial_status?: Database["public"]["Enums"]["commercial_status_enum"]
          company_id?: string | null
          created_at?: string
          display_address?: string | null
          display_name?: string | null
          enrichment_run_id?: string | null
          enrichment_version?: string | null
          id?: string
          identity_confidence?: number
          last_enriched_at?: string | null
          manual_review_reason?: string | null
          phmsa_address?: string
          phmsa_name?: string
          phone?: string | null
          pipeline_status?: string
          postal_code?: string | null
          publish_status?: Database["public"]["Enums"]["publish_status_enum"]
          rin?: string
          source_effective_date?: string | null
          source_row_count?: number
          state?: string
          updated_at?: string
          verified_at?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_enrichment_run_id_fkey"
            columns: ["enrichment_run_id"]
            isOneToOne: false
            referencedRelation: "enrichment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_enrichment_results: {
        Row: {
          business_status: Database["public"]["Enums"]["business_status_enum"]
          checked_at: string
          current_address: string | null
          current_name: string | null
          decision: Database["public"]["Enums"]["publish_status_enum"]
          evidence_summary: string | null
          facility_id: string
          id: string
          identity_confidence: number
          identity_match: Database["public"]["Enums"]["identity_match_enum"]
          manual_review_reason: string | null
          raw_result: Json
          run_id: string
          serves_external_customers: Database["public"]["Enums"]["external_customer_status_enum"]
          service_confidence: number
          service_keys: string[]
        }
        Insert: {
          business_status?: Database["public"]["Enums"]["business_status_enum"]
          checked_at?: string
          current_address?: string | null
          current_name?: string | null
          decision?: Database["public"]["Enums"]["publish_status_enum"]
          evidence_summary?: string | null
          facility_id: string
          id?: string
          identity_confidence?: number
          identity_match?: Database["public"]["Enums"]["identity_match_enum"]
          manual_review_reason?: string | null
          raw_result?: Json
          run_id: string
          serves_external_customers?: Database["public"]["Enums"]["external_customer_status_enum"]
          service_confidence?: number
          service_keys?: string[]
        }
        Update: {
          business_status?: Database["public"]["Enums"]["business_status_enum"]
          checked_at?: string
          current_address?: string | null
          current_name?: string | null
          decision?: Database["public"]["Enums"]["publish_status_enum"]
          evidence_summary?: string | null
          facility_id?: string
          id?: string
          identity_confidence?: number
          identity_match?: Database["public"]["Enums"]["identity_match_enum"]
          manual_review_reason?: string | null
          raw_result?: Json
          run_id?: string
          serves_external_customers?: Database["public"]["Enums"]["external_customer_status_enum"]
          service_confidence?: number
          service_keys?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "facility_enrichment_results_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facility_enrichment_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "enrichment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      facility_services: {
        Row: {
          confidence: number
          created_at: string
          facility_id: string
          id: string
          service_key: string
          status: Database["public"]["Enums"]["service_status_enum"]
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          facility_id: string
          id?: string
          service_key: string
          status?: Database["public"]["Enums"]["service_status_enum"]
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          facility_id?: string
          id?: string
          service_key?: string
          status?: Database["public"]["Enums"]["service_status_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facility_services_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      source_records: {
        Row: {
          captured_at: string
          effective_date: string | null
          facility_id: string
          hydrostatic_authorized: boolean
          id: string
          raw_payload: Json
          source: string
        }
        Insert: {
          captured_at?: string
          effective_date?: string | null
          facility_id: string
          hydrostatic_authorized?: boolean
          id?: string
          raw_payload: Json
          source: string
        }
        Update: {
          captured_at?: string
          effective_date?: string | null
          facility_id?: string
          hydrostatic_authorized?: boolean
          id?: string
          raw_payload?: Json
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_claims_queue: {
        Args: never
        Returns: {
          city: string
          claim_created_at: string
          claim_id: string
          claim_status: Database["public"]["Enums"]["claim_status_enum"]
          claimant_email: string
          claimant_user_id: string
          display_address: string
          display_name: string
          facility_id: string
          phmsa_address: string
          phmsa_name: string
          reviewed_at: string
          reviewed_by: string
          rin: string
          state: string
          verification_method: string
        }[]
      }
      admin_review_claim: {
        Args: {
          p_claim_id: string
          p_status: Database["public"]["Enums"]["claim_status_enum"]
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      business_status_enum:
        | "active"
        | "inactive"
        | "internal"
        | "not_public"
        | "unknown"
      claim_status_enum: "pending" | "verified" | "rejected"
      commercial_status_enum: "yes" | "no" | "unknown"
      correction_status_enum: "pending" | "accepted" | "rejected"
      enrichment_run_status_enum:
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
      evidence_type_enum:
        | "regulatory"
        | "first_party"
        | "business_registry"
        | "directory"
        | "provider_claim"
        | "other"
      external_customer_status_enum: "yes" | "no" | "unknown"
      identity_match_enum: "matched" | "changed" | "conflict" | "unknown"
      publish_status_enum: "publish" | "review" | "exclude"
      service_status_enum:
        | "verified"
        | "inferred"
        | "provider_confirmed"
        | "rejected"
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
    Enums: {
      business_status_enum: [
        "active",
        "inactive",
        "internal",
        "not_public",
        "unknown",
      ],
      claim_status_enum: ["pending", "verified", "rejected"],
      commercial_status_enum: ["yes", "no", "unknown"],
      correction_status_enum: ["pending", "accepted", "rejected"],
      enrichment_run_status_enum: [
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
      ],
      evidence_type_enum: [
        "regulatory",
        "first_party",
        "business_registry",
        "directory",
        "provider_claim",
        "other",
      ],
      external_customer_status_enum: ["yes", "no", "unknown"],
      identity_match_enum: ["matched", "changed", "conflict", "unknown"],
      publish_status_enum: ["publish", "review", "exclude"],
      service_status_enum: [
        "verified",
        "inferred",
        "provider_confirmed",
        "rejected",
      ],
    },
  },
} as const
