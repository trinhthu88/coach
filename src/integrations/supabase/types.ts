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
      access_requests: {
        Row: {
          company: string | null
          created_at: string
          credential: string | null
          email: string
          full_name: string
          id: string
          industry: string | null
          job_title: string | null
          linkedin_url: string | null
          motivation: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          credential?: string | null
          email: string
          full_name: string
          id?: string
          industry?: string | null
          job_title?: string | null
          linkedin_url?: string | null
          motivation?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role: string
          status?: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          credential?: string | null
          email?: string
          full_name?: string
          id?: string
          industry?: string | null
          job_title?: string | null
          linkedin_url?: string | null
          motivation?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_alerts: {
        Row: {
          alert_type: string
          created_at: string
          id: string
          message: string | null
          related_coach_id: string | null
          related_coachee_id: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          title: string
          updated_at: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          id?: string
          message?: string | null
          related_coach_id?: string | null
          related_coachee_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          title: string
          updated_at?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          id?: string
          message?: string | null
          related_coach_id?: string | null
          related_coachee_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_as_coachee_allowlist: {
        Row: {
          coach_user_id: string
          created_at: string
          created_by: string | null
          id: string
          selectable_coach_id: string
        }
        Insert: {
          coach_user_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          selectable_coach_id: string
        }
        Update: {
          coach_user_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          selectable_coach_id?: string
        }
        Relationships: []
      }
      coach_availability: {
        Row: {
          coach_id: string
          created_at: string
          end_time: string
          id: string
          is_booked: boolean
          session_id: string | null
          slot_date: string
          slot_type: Database["public"]["Enums"]["availability_slot_type"]
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
          slot_type?: Database["public"]["Enums"]["availability_slot_type"]
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
          slot_type?: Database["public"]["Enums"]["availability_slot_type"]
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      coach_client_notes: {
        Row: {
          body: string
          coach_id: string
          coachee_id: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          body: string
          coach_id: string
          coachee_id: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          body?: string
          coach_id?: string
          coachee_id?: string
          created_at?: string
          id?: string
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
          peer_coaching_opt_in: boolean
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
          peer_coaching_opt_in?: boolean
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
          peer_coaching_opt_in?: boolean
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
      coach_session_limits: {
        Row: {
          coach_user_id: string | null
          created_at: string
          id: string
          monthly_limit: number
          notes: string | null
          peer_monthly_limit: number
          updated_at: string
        }
        Insert: {
          coach_user_id?: string | null
          created_at?: string
          id?: string
          monthly_limit?: number
          notes?: string | null
          peer_monthly_limit?: number
          updated_at?: string
        }
        Update: {
          coach_user_id?: string | null
          created_at?: string
          id?: string
          monthly_limit?: number
          notes?: string | null
          peer_monthly_limit?: number
          updated_at?: string
        }
        Relationships: []
      }
      coach_session_private_notes: {
        Row: {
          body: string
          coach_id: string
          created_at: string
          session_id: string
          updated_at: string
        }
        Insert: {
          body?: string
          coach_id: string
          created_at?: string
          session_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          coach_id?: string
          created_at?: string
          session_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      coachee_coach_allowlist: {
        Row: {
          coach_id: string
          coachee_id: string
          created_at: string
          created_by: string | null
          id: string
        }
        Insert: {
          coach_id: string
          coachee_id: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Update: {
          coach_id?: string
          coachee_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Relationships: []
      }
      coachee_goals: {
        Row: {
          coachee_id: string
          created_at: string
          description: string | null
          id: string
          sort_order: number
          status: string
          target_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          coachee_id: string
          created_at?: string
          description?: string | null
          id?: string
          sort_order?: number
          status?: string
          target_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          coachee_id?: string
          created_at?: string
          description?: string | null
          id?: string
          sort_order?: number
          status?: string
          target_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      coachee_milestones: {
        Row: {
          coachee_id: string
          created_at: string
          done_at: string | null
          goal_id: string
          id: string
          is_done: boolean
          sort_order: number
          target_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          coachee_id: string
          created_at?: string
          done_at?: string | null
          goal_id: string
          id?: string
          is_done?: boolean
          sort_order?: number
          target_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          coachee_id?: string
          created_at?: string
          done_at?: string | null
          goal_id?: string
          id?: string
          is_done?: boolean
          sort_order?: number
          target_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coachee_milestones_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "coachee_goals"
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
      coachee_reflections: {
        Row: {
          body: string
          coachee_id: string
          created_at: string
          id: string
          mood: string | null
          updated_at: string
        }
        Insert: {
          body: string
          coachee_id: string
          created_at?: string
          id?: string
          mood?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          coachee_id?: string
          created_at?: string
          id?: string
          mood?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cohorts: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          name: string
          programme_id: string | null
          start_date: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          programme_id?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          programme_id?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohorts_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      peer_coach_session_private_notes: {
        Row: {
          body: string
          created_at: string
          peer_coach_id: string
          peer_session_id: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          peer_coach_id: string
          peer_session_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          peer_coach_id?: string
          peer_session_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      peer_session_competency_feedback: {
        Row: {
          coaching_mindset: number | null
          created_at: string
          ethical_practice: number | null
          evokes_awareness: number | null
          facilitates_growth: number | null
          feedback_note: string | null
          id: string
          listens_actively: number | null
          maintains_agreements: number | null
          maintains_presence: number | null
          peer_coach_id: string
          peer_coachee_id: string
          peer_session_id: string
          trust_safety: number | null
          updated_at: string
        }
        Insert: {
          coaching_mindset?: number | null
          created_at?: string
          ethical_practice?: number | null
          evokes_awareness?: number | null
          facilitates_growth?: number | null
          feedback_note?: string | null
          id?: string
          listens_actively?: number | null
          maintains_agreements?: number | null
          maintains_presence?: number | null
          peer_coach_id: string
          peer_coachee_id: string
          peer_session_id: string
          trust_safety?: number | null
          updated_at?: string
        }
        Update: {
          coaching_mindset?: number | null
          created_at?: string
          ethical_practice?: number | null
          evokes_awareness?: number | null
          facilitates_growth?: number | null
          feedback_note?: string | null
          id?: string
          listens_actively?: number | null
          maintains_agreements?: number | null
          maintains_presence?: number | null
          peer_coach_id?: string
          peer_coachee_id?: string
          peer_session_id?: string
          trust_safety?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      peer_sessions: {
        Row: {
          action_items: Json
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          coach_notes: string | null
          coachee_notes: string | null
          coachee_rated_at: string | null
          coachee_rating: number | null
          coachee_rating_comment: string | null
          confirmed_at: string | null
          created_at: string
          duration_minutes: number
          id: string
          meeting_url: string | null
          peer_coach_id: string
          peer_coachee_id: string
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
          coach_notes?: string | null
          coachee_notes?: string | null
          coachee_rated_at?: string | null
          coachee_rating?: number | null
          coachee_rating_comment?: string | null
          confirmed_at?: string | null
          created_at?: string
          duration_minutes: number
          id?: string
          meeting_url?: string | null
          peer_coach_id: string
          peer_coachee_id: string
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
          coach_notes?: string | null
          coachee_notes?: string | null
          coachee_rated_at?: string | null
          coachee_rating?: number | null
          coachee_rating_comment?: string | null
          confirmed_at?: string | null
          created_at?: string
          duration_minutes?: number
          id?: string
          meeting_url?: string | null
          peer_coach_id?: string
          peer_coachee_id?: string
          slot_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["session_status"]
          topic?: string
          updated_at?: string
        }
        Relationships: []
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
          must_change_password: boolean
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
          must_change_password?: boolean
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
          must_change_password?: boolean
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      programme_enrollments: {
        Row: {
          coachee_id: string
          cohort_id: string | null
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          programme_id: string
          progress_pct: number
          start_date: string
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
        }
        Insert: {
          coachee_id: string
          cohort_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          programme_id: string
          progress_pct?: number
          start_date?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Update: {
          coachee_id?: string
          cohort_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          programme_id?: string
          progress_pct?: number
          start_date?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_enrollments_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_enrollments_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      programmes: {
        Row: {
          coach_session_limit: number
          coachee_session_limit: number
          color: string | null
          created_at: string
          description: string | null
          duration_months: number
          id: string
          is_active: boolean
          name: string
          peer_session_limit: number
          total_sessions: number
          updated_at: string
        }
        Insert: {
          coach_session_limit?: number
          coachee_session_limit?: number
          color?: string | null
          created_at?: string
          description?: string | null
          duration_months?: number
          id?: string
          is_active?: boolean
          name: string
          peer_session_limit?: number
          total_sessions?: number
          updated_at?: string
        }
        Update: {
          coach_session_limit?: number
          coachee_session_limit?: number
          color?: string | null
          created_at?: string
          description?: string | null
          duration_months?: number
          id?: string
          is_active?: boolean
          name?: string
          peer_session_limit?: number
          total_sessions?: number
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
      session_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
          session_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
          session_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          action_items: Json
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          coach_id: string
          coach_notes: string | null
          coachee_id: string
          coachee_notes: string | null
          coachee_rated_at: string | null
          coachee_rating: number | null
          coachee_rating_comment: string | null
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
          coachee_id: string
          coachee_notes?: string | null
          coachee_rated_at?: string | null
          coachee_rating?: number | null
          coachee_rating_comment?: string | null
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
          coachee_id?: string
          coachee_notes?: string | null
          coachee_rated_at?: string | null
          coachee_rating?: number | null
          coachee_rating_comment?: string | null
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
      staged_enrollments: {
        Row: {
          applied_at: string | null
          cohort_id: string | null
          created_at: string
          created_by: string | null
          email: string
          full_name: string | null
          id: string
          programme_id: string | null
        }
        Insert: {
          applied_at?: string | null
          cohort_id?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          full_name?: string | null
          id?: string
          programme_id?: string | null
        }
        Update: {
          applied_at?: string | null
          cohort_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          full_name?: string | null
          id?: string
          programme_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staged_enrollments_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staged_enrollments_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
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
      bulk_create_availability: {
        Args: {
          _coach_id: string
          _start_date: string
          _template: Json
          _weeks: number
        }
        Returns: number
      }
      can_message_session: {
        Args: { _session_id: string; _user_id: string }
        Returns: boolean
      }
      coach_has_client: {
        Args: { _coach_id: string; _coachee_id: string }
        Returns: boolean
      }
      coach_visible_to_coachee: {
        Args: { _coach_id: string; _coachee_id: string }
        Returns: boolean
      }
      coachee_has_allowlist: { Args: { _coachee_id: string }; Returns: boolean }
      get_coach_peer_session_usage: {
        Args: { _coach_id: string }
        Returns: {
          peer_monthly_limit: number
          used_this_month: number
        }[]
      }
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
      is_allowlisted_pair: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
      shares_session_with: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
    }
    Enums: {
      alert_severity: "info" | "warning" | "critical"
      app_role: "admin" | "coach" | "coachee"
      availability_slot_type: "coaching" | "peer"
      enrollment_status: "active" | "completed" | "paused" | "at_risk"
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
        | "reach_limit"
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
      alert_severity: ["info", "warning", "critical"],
      app_role: ["admin", "coach", "coachee"],
      availability_slot_type: ["coaching", "peer"],
      enrollment_status: ["active", "completed", "paused", "at_risk"],
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
        "reach_limit",
      ],
    },
  },
} as const
