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
      coach_availability: {
        Row: {
          coach_id: string
          created_at: string
          end_time: string
          id: string
          is_booked: boolean
          session_id: string | null
          slot_date: string
          start_time: string
          updated_at: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          end_time: string
          id?: string
          is_booked?: boolean
          session_id?: string | null
          slot_date: string
          start_time: string
          updated_at?: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          end_time?: string
          id?: string
          is_booked?: boolean
          session_id?: string | null
          slot_date?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_profiles: {
        Row: {
          approval_status: Database["public"]["Enums"]["user_status"]
          calendly_url: string | null
          country_based: string | null
          created_at: string
          diplomas_certifications: string[] | null
          hourly_rate: number | null
          id: string
          is_featured: boolean
          last_approved_at: string | null
          last_profile_update_at: string
          nationality: string | null
          rating_avg: number
          sessions_completed: number
          specialties: string[] | null
          title: string | null
          updated_at: string
          years_experience: number | null
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["user_status"]
          calendly_url?: string | null
          country_based?: string | null
          created_at?: string
          diplomas_certifications?: string[] | null
          hourly_rate?: number | null
          id: string
          is_featured?: boolean
          last_approved_at?: string | null
          last_profile_update_at?: string
          nationality?: string | null
          rating_avg?: number
          sessions_completed?: number
          specialties?: string[] | null
          title?: string | null
          updated_at?: string
          years_experience?: number | null
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["user_status"]
          calendly_url?: string | null
          country_based?: string | null
          created_at?: string
          diplomas_certifications?: string[] | null
          hourly_rate?: number | null
          id?: string
          is_featured?: boolean
          last_approved_at?: string | null
          last_profile_update_at?: string
          nationality?: string | null
          rating_avg?: number
          sessions_completed?: number
          specialties?: string[] | null
          title?: string | null
          updated_at?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coachee_profiles: {
        Row: {
          approval_status: Database["public"]["Enums"]["user_status"]
          created_at: string
          goals: string | null
          id: string
          industry: string | null
          job_title: string | null
          last_approved_at: string | null
          last_profile_update_at: string
          location: string | null
          phone: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["user_status"]
          created_at?: string
          goals?: string | null
          id: string
          industry?: string | null
          job_title?: string | null
          last_approved_at?: string | null
          last_profile_update_at?: string
          location?: string | null
          phone?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["user_status"]
          created_at?: string
          goals?: string | null
          id?: string
          industry?: string | null
          job_title?: string | null
          last_approved_at?: string | null
          last_profile_update_at?: string
          location?: string | null
          phone?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coachee_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          last_profile_update_at: string
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          last_profile_update_at?: string
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          last_profile_update_at?: string
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      session_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          session_id: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          session_id: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          session_id?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attachments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_limits: {
        Row: {
          coachee_id: string | null
          created_at: string
          id: string
          monthly_limit: number
          notes: string | null
          updated_at: string
        }
        Insert: {
          coachee_id?: string | null
          created_at?: string
          id?: string
          monthly_limit?: number
          notes?: string | null
          updated_at?: string
        }
        Update: {
          coachee_id?: string | null
          created_at?: string
          id?: string
          monthly_limit?: number
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          action_items: Json
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          coach_id: string
          coach_notes: string | null
          coach_private_notes: string | null
          coachee_id: string
          coachee_notes: string | null
          confirmed_at: string | null
          created_at: string
          duration_minutes: number
          id: string
          meeting_url: string | null
          slot_id: string | null
          start_time: string
          status: Database["public"]["Enums"]["session_status"]
          topic: string
          updated_at: string
        }
        Insert: {
          action_items?: Json
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          coach_id: string
          coach_notes?: string | null
          coach_private_notes?: string | null
          coachee_id: string
          coachee_notes?: string | null
          confirmed_at?: string | null
          created_at?: string
          duration_minutes: number
          id?: string
          meeting_url?: string | null
          slot_id?: string | null
          start_time: string
          status?: Database["public"]["Enums"]["session_status"]
          topic: string
          updated_at?: string
        }
        Update: {
          action_items?: Json
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          coach_id?: string
          coach_notes?: string | null
          coach_private_notes?: string | null
          coachee_id?: string
          coachee_notes?: string | null
          confirmed_at?: string | null
          created_at?: string
          duration_minutes?: number
          id?: string
          meeting_url?: string | null
          slot_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["session_status"]
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_coachee_id_fkey"
            columns: ["coachee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      get_coachee_session_usage: {
        Args: { _coachee_id: string }
        Returns: {
          monthly_limit: number
          used_this_month: number
        }[]
      }
      get_primary_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "coach" | "coachee"
      session_status:
        | "pending_coach_approval"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "rescheduled"
      user_status:
        | "inactive"
        | "pending_approval"
        | "active"
        | "suspended"
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
      app_role: ["admin", "coach", "coachee"],
      session_status: [
        "pending_coach_approval",
        "confirmed",
        "completed",
        "cancelled",
        "rescheduled",
      ],
      user_status: [
        "inactive",
        "pending_approval",
        "active",
        "suspended",
        "rejected",
      ],
    },
  },
} as const
