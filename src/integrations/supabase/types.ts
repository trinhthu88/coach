export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
          related_enrollment_id: string | null
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
          related_enrollment_id?: string | null
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
          related_enrollment_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_alerts_related_enrollment_id_fkey"
            columns: ["related_enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_submissions: {
        Row: {
          answers: Json
          assignment_id: string
          correct_count: number | null
          enrollment_id: string
          id: string
          reflection_text: string | null
          score_pct: number | null
          submitted_at: string
          total_count: number | null
          user_id: string
        }
        Insert: {
          answers?: Json
          assignment_id: string
          correct_count?: number | null
          enrollment_id: string
          id?: string
          reflection_text?: string | null
          score_pct?: number | null
          submitted_at?: string
          total_count?: number | null
          user_id: string
        }
        Update: {
          answers?: Json
          assignment_id?: string
          correct_count?: number | null
          enrollment_id?: string
          id?: string
          reflection_text?: string | null
          score_pct?: number | null
          submitted_at?: string
          total_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submissions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          assignment_type: Database["public"]["Enums"]["assignment_type"]
          created_at: string
          due_offset_days: number | null
          id: string
          instructions: string | null
          instructions_vi: string | null
          is_visible: boolean
          sort_order: number
          title: string
          title_vi: string | null
          training_week_id: string
          updated_at: string
        }
        Insert: {
          assignment_type: Database["public"]["Enums"]["assignment_type"]
          created_at?: string
          due_offset_days?: number | null
          id?: string
          instructions?: string | null
          instructions_vi?: string | null
          is_visible?: boolean
          sort_order?: number
          title: string
          title_vi?: string | null
          training_week_id: string
          updated_at?: string
        }
        Update: {
          assignment_type?: Database["public"]["Enums"]["assignment_type"]
          created_at?: string
          due_offset_days?: number | null
          id?: string
          instructions?: string | null
          instructions_vi?: string | null
          is_visible?: boolean
          sort_order?: number
          title?: string
          title_vi?: string | null
          training_week_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_training_week_id_fkey"
            columns: ["training_week_id"]
            isOneToOne: false
            referencedRelation: "training_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_invite_batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          total_rows: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          total_rows?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_invite_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_invite_rows: {
        Row: {
          assign_coach_id: string | null
          batch_id: string | null
          created_at: string
          created_user_id: string | null
          email: string | null
          error_message: string | null
          full_name: string | null
          id: string
          role: string | null
          row_index: number | null
          session_limit: number | null
          status: string | null
        }
        Insert: {
          assign_coach_id?: string | null
          batch_id?: string | null
          created_at?: string
          created_user_id?: string | null
          email?: string | null
          error_message?: string | null
          full_name?: string | null
          id?: string
          role?: string | null
          row_index?: number | null
          session_limit?: number | null
          status?: string | null
        }
        Update: {
          assign_coach_id?: string | null
          batch_id?: string | null
          created_at?: string
          created_user_id?: string | null
          email?: string | null
          error_message?: string | null
          full_name?: string | null
          id?: string
          role?: string | null
          row_index?: number | null
          session_limit?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_invite_rows_assign_coach_id_fkey"
            columns: ["assign_coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_invite_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "bulk_invite_batches"
            referencedColumns: ["id"]
          },
        ]
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
          max_coachee_invites: number | null
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
          max_coachee_invites?: number | null
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
          max_coachee_invites?: number | null
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
      coach_programme_enrollments: {
        Row: {
          coach_id: string
          coach_programme_id: string
          created_at: string
          end_date: string | null
          id: string
          start_date: string
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
        }
        Insert: {
          coach_id: string
          coach_programme_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          start_date?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Update: {
          coach_id?: string
          coach_programme_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          start_date?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_programme_enrollments_coach_programme_id_fkey"
            columns: ["coach_programme_id"]
            isOneToOne: false
            referencedRelation: "coach_programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_programmes: {
        Row: {
          client_coaching_limit: number | null
          color: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          mentee_sessions_limit: number | null
          mentoring_given_limit: number | null
          mentoring_received_limit: number | null
          name: string
          peer_given_limit: number | null
          peer_received_limit: number | null
          updated_at: string
        }
        Insert: {
          client_coaching_limit?: number | null
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          mentee_sessions_limit?: number | null
          mentoring_given_limit?: number | null
          mentoring_received_limit?: number | null
          name: string
          peer_given_limit?: number | null
          peer_received_limit?: number | null
          updated_at?: string
        }
        Update: {
          client_coaching_limit?: number | null
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          mentee_sessions_limit?: number | null
          mentoring_given_limit?: number | null
          mentoring_received_limit?: number | null
          name?: string
          peer_given_limit?: number | null
          peer_received_limit?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      coach_session_feedback: {
        Row: {
          coach_id: string
          created_at: string
          engagement_level: string | null
          flag_for_admin: boolean
          flag_notes: string | null
          id: string
          quality_rating: number | null
          session_id: string
          updated_at: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          engagement_level?: string | null
          flag_for_admin?: boolean
          flag_notes?: string | null
          id?: string
          quality_rating?: number | null
          session_id: string
          updated_at?: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          engagement_level?: string | null
          flag_for_admin?: boolean
          flag_notes?: string | null
          id?: string
          quality_rating?: number | null
          session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_session_feedback_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_session_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
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
          peer_given_monthly_limit: number
          peer_monthly_limit: number
          updated_at: string
        }
        Insert: {
          coach_user_id?: string | null
          created_at?: string
          id?: string
          monthly_limit?: number
          notes?: string | null
          peer_given_monthly_limit?: number
          peer_monthly_limit?: number
          updated_at?: string
        }
        Update: {
          coach_user_id?: string | null
          created_at?: string
          id?: string
          monthly_limit?: number
          notes?: string | null
          peer_given_monthly_limit?: number
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
      coachee_availability: {
        Row: {
          coachee_id: string
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
          coachee_id: string
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
          coachee_id?: string
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
      coachee_coach_allowlist: {
        Row: {
          coach_id: string
          coachee_id: string
          created_at: string
          created_by: string | null
          id: string
          removed_at: string | null
          source: string
        }
        Insert: {
          coach_id: string
          coachee_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          removed_at?: string | null
          source?: string
        }
        Update: {
          coach_id?: string
          coachee_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          removed_at?: string | null
          source?: string
        }
        Relationships: []
      }
      coachee_goal_ratings: {
        Row: {
          coachee_id: string
          created_at: string
          current_rating: number | null
          current_updated_at: string
          enrollment_id: string
          goal_id: string
          id: string
          start_rating: number | null
          target_rating: number | null
          updated_at: string
        }
        Insert: {
          coachee_id: string
          created_at?: string
          current_rating?: number | null
          current_updated_at?: string
          enrollment_id: string
          goal_id: string
          id?: string
          start_rating?: number | null
          target_rating?: number | null
          updated_at?: string
        }
        Update: {
          coachee_id?: string
          created_at?: string
          current_rating?: number | null
          current_updated_at?: string
          enrollment_id?: string
          goal_id?: string
          id?: string
          start_rating?: number | null
          target_rating?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coachee_goal_ratings_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      coachee_goals: {
        Row: {
          coachee_id: string
          created_at: string
          description: string | null
          enrollment_id: string | null
          id: string
          shared_with_sponsor: boolean
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
          enrollment_id?: string | null
          id?: string
          shared_with_sponsor?: boolean
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
          enrollment_id?: string | null
          id?: string
          shared_with_sponsor?: boolean
          sort_order?: number
          status?: string
          target_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coachee_goals_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      coachee_milestones: {
        Row: {
          coachee_id: string
          created_at: string
          done_at: string | null
          enrollment_id: string | null
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
          enrollment_id?: string | null
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
          enrollment_id?: string | null
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
            foreignKeyName: "coachee_milestones_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coachee_milestones_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "coachee_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      coachee_peer_sessions: {
        Row: {
          action_items: Json
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          created_at: string
          duration_minutes: number
          enrollment_id: string
          id: string
          meeting_url: string | null
          peer_provider_id: string
          peer_receiver_id: string
          provider_notes: string | null
          provider_private_notes: string | null
          receiver_notes: string | null
          receiver_rated_at: string | null
          receiver_rating: number | null
          receiver_rating_comment: string | null
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
          confirmed_at?: string | null
          created_at?: string
          duration_minutes: number
          enrollment_id: string
          id?: string
          meeting_url?: string | null
          peer_provider_id: string
          peer_receiver_id: string
          provider_notes?: string | null
          provider_private_notes?: string | null
          receiver_notes?: string | null
          receiver_rated_at?: string | null
          receiver_rating?: number | null
          receiver_rating_comment?: string | null
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
          confirmed_at?: string | null
          created_at?: string
          duration_minutes?: number
          enrollment_id?: string
          id?: string
          meeting_url?: string | null
          peer_provider_id?: string
          peer_receiver_id?: string
          provider_notes?: string | null
          provider_private_notes?: string | null
          receiver_notes?: string | null
          receiver_rated_at?: string | null
          receiver_rating?: number | null
          receiver_rating_comment?: string | null
          slot_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["session_status"]
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coachee_peer_sessions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
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
          enrollment_id: string | null
          id: string
          mood: string | null
          updated_at: string
        }
        Insert: {
          body: string
          coachee_id: string
          created_at?: string
          enrollment_id?: string | null
          id?: string
          mood?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          coachee_id?: string
          created_at?: string
          enrollment_id?: string | null
          id?: string
          mood?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coachee_reflections_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_requirement_dates: {
        Row: {
          cohort_id: string
          created_at: string
          due_on: string
          generated_due_on: string | null
          generation_method: string
          id: string
          is_overridden: boolean
          materialized_via: string
          module: Database["public"]["Enums"]["programme_module_type"]
          ordinal: number
          programme_id: string
          training_week_id: string | null
          units: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cohort_id: string
          created_at?: string
          due_on: string
          generated_due_on?: string | null
          generation_method: string
          id?: string
          is_overridden?: boolean
          materialized_via: string
          module: Database["public"]["Enums"]["programme_module_type"]
          ordinal: number
          programme_id: string
          training_week_id?: string | null
          units?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cohort_id?: string
          created_at?: string
          due_on?: string
          generated_due_on?: string | null
          generation_method?: string
          id?: string
          is_overridden?: boolean
          materialized_via?: string
          module?: Database["public"]["Enums"]["programme_module_type"]
          ordinal?: number
          programme_id?: string
          training_week_id?: string | null
          units?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cohort_requirement_dates_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_requirement_dates_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_requirement_dates_training_week_id_fkey"
            columns: ["training_week_id"]
            isOneToOne: false
            referencedRelation: "training_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_triad_operations: {
        Row: {
          assignment_status: string
          cohort_requirement_date_id: string
          last_assignment_run_at: string | null
          last_assignment_summary: Json | null
          updated_at: string
        }
        Insert: {
          assignment_status?: string
          cohort_requirement_date_id: string
          last_assignment_run_at?: string | null
          last_assignment_summary?: Json | null
          updated_at?: string
        }
        Update: {
          assignment_status?: string
          cohort_requirement_date_id?: string
          last_assignment_run_at?: string | null
          last_assignment_summary?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohort_triad_operations_cohort_requirement_date_id_fkey"
            columns: ["cohort_requirement_date_id"]
            isOneToOne: true
            referencedRelation: "cohort_requirement_dates"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_week_overrides: {
        Row: {
          cohort_id: string
          is_visible: boolean | null
          training_week_id: string
          unlock_date: string | null
        }
        Insert: {
          cohort_id: string
          is_visible?: boolean | null
          training_week_id: string
          unlock_date?: string | null
        }
        Update: {
          cohort_id?: string
          is_visible?: boolean | null
          training_week_id?: string
          unlock_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cohort_week_overrides_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_week_overrides_training_week_id_fkey"
            columns: ["training_week_id"]
            isOneToOne: false
            referencedRelation: "training_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      cohorts: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          name: string
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          programme_id?: string | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohorts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohorts_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_prompt_responses: {
        Row: {
          confidence_score: number | null
          created_at: string
          daily_prompt_id: string
          enrollment_id: string
          id: string
          opened_at: string | null
          responded_at: string | null
          response_text: string | null
          user_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          daily_prompt_id: string
          enrollment_id: string
          id?: string
          opened_at?: string | null
          responded_at?: string | null
          response_text?: string | null
          user_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          daily_prompt_id?: string
          enrollment_id?: string
          id?: string
          opened_at?: string | null
          responded_at?: string | null
          response_text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_prompt_responses_daily_prompt_id_fkey"
            columns: ["daily_prompt_id"]
            isOneToOne: false
            referencedRelation: "daily_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_prompt_responses_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_prompt_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_prompts: {
        Row: {
          created_at: string
          day_offset: number
          id: string
          is_visible: boolean
          prompt_text: string
          prompt_text_vi: string | null
          sort_order: number
          training_week_id: string
        }
        Insert: {
          created_at?: string
          day_offset: number
          id?: string
          is_visible?: boolean
          prompt_text: string
          prompt_text_vi?: string | null
          sort_order?: number
          training_week_id: string
        }
        Update: {
          created_at?: string
          day_offset?: number
          id?: string
          is_visible?: boolean
          prompt_text?: string
          prompt_text_vi?: string | null
          sort_order?: number
          training_week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_prompts_training_week_id_fkey"
            columns: ["training_week_id"]
            isOneToOne: false
            referencedRelation: "training_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_action_backfill_audit: {
        Row: {
          item_ordinal: number
          source_activity_id: string
          source_activity_type: string
          unresolved_reason: string
        }
        Insert: {
          item_ordinal: number
          source_activity_id: string
          source_activity_type: string
          unresolved_reason: string
        }
        Update: {
          item_ordinal?: number
          source_activity_id?: string
          source_activity_type?: string
          unresolved_reason?: string
        }
        Relationships: []
      }
      enrollment_actions: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          enrollment_id: string
          goal_id: string | null
          id: string
          milestone_id: string | null
          owner_user_id: string
          source_activity_id: string | null
          source_activity_type: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          enrollment_id: string
          goal_id?: string | null
          id?: string
          milestone_id?: string | null
          owner_user_id: string
          source_activity_id?: string | null
          source_activity_type?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          enrollment_id?: string
          goal_id?: string | null
          id?: string
          milestone_id?: string | null
          owner_user_id?: string
          source_activity_id?: string | null
          source_activity_type?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_actions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_actions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "coachee_goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_actions_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "coachee_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_actions_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_module_milestones: {
        Row: {
          created_at: string
          due_on: string
          enrollment_module_snapshot_id: string
          id: string
          required_units: number
          sequence: number
          training_week_id: string | null
          window_end_on: string | null
        }
        Insert: {
          created_at?: string
          due_on: string
          enrollment_module_snapshot_id: string
          id?: string
          required_units?: number
          sequence: number
          training_week_id?: string | null
          window_end_on?: string | null
        }
        Update: {
          created_at?: string
          due_on?: string
          enrollment_module_snapshot_id?: string
          id?: string
          required_units?: number
          sequence?: number
          training_week_id?: string | null
          window_end_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_module_milestones_enrollment_module_snapshot_id_fkey"
            columns: ["enrollment_module_snapshot_id"]
            isOneToOne: false
            referencedRelation: "enrollment_module_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_module_milestones_training_week_id_fkey"
            columns: ["training_week_id"]
            isOneToOne: false
            referencedRelation: "training_weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_module_snapshots: {
        Row: {
          config: Json
          created_at: string
          distribution_mode: string
          distribution_settings: Json
          ends_on: string
          enrollment_id: string
          id: string
          module: Database["public"]["Enums"]["programme_module_type"]
          programme_module_id: string
          required: boolean
          required_units: number
          starts_on: string
          weight: number | null
        }
        Insert: {
          config?: Json
          created_at?: string
          distribution_mode?: string
          distribution_settings?: Json
          ends_on: string
          enrollment_id: string
          id?: string
          module: Database["public"]["Enums"]["programme_module_type"]
          programme_module_id: string
          required?: boolean
          required_units?: number
          starts_on: string
          weight?: number | null
        }
        Update: {
          config?: Json
          created_at?: string
          distribution_mode?: string
          distribution_settings?: Json
          ends_on?: string
          enrollment_id?: string
          id?: string
          module?: Database["public"]["Enums"]["programme_module_type"]
          programme_module_id?: string
          required?: boolean
          required_units?: number
          starts_on?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_module_snapshots_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_module_snapshots_programme_module_id_fkey"
            columns: ["programme_module_id"]
            isOneToOne: false
            referencedRelation: "programme_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_ownership_retirements: {
        Row: {
          domain: string
          evidence: Json
          migration_id: string
          parent_record_id: string | null
          reason: string
          record_id: string
          retired_at: string
          source_activity_id: string | null
          source_activity_type: string | null
          user_id: string | null
        }
        Insert: {
          domain: string
          evidence?: Json
          migration_id: string
          parent_record_id?: string | null
          reason: string
          record_id: string
          retired_at?: string
          source_activity_id?: string | null
          source_activity_type?: string | null
          user_id?: string | null
        }
        Update: {
          domain?: string
          evidence?: Json
          migration_id?: string
          parent_record_id?: string | null
          reason?: string
          record_id?: string
          retired_at?: string
          source_activity_id?: string | null
          source_activity_type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      enrollment_schedule_backfill_audit: {
        Row: {
          enrollment_id: string
          first_seen_at: string
          last_seen_at: string
          metadata: Json
          reason: string
        }
        Insert: {
          enrollment_id: string
          first_seen_at?: string
          last_seen_at?: string
          metadata?: Json
          reason: string
        }
        Update: {
          enrollment_id?: string
          first_seen_at?: string
          last_seen_at?: string
          metadata?: Json
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_schedule_backfill_audit_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: true
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_checkin_submissions: {
        Row: {
          actor_user_id: string
          created_at: string
          enrollment_id: string
          payload: Json
          payload_hash: string
          source_activity_id: string
          source_activity_type: string
          submission_id: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          enrollment_id: string
          payload: Json
          payload_hash: string
          source_activity_id: string
          source_activity_type: string
          submission_id: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          enrollment_id?: string
          payload?: Json
          payload_hash?: string
          source_activity_id?: string
          source_activity_type?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_checkin_submissions_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_submissions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_checkins: {
        Row: {
          actor_user_id: string
          created_at: string
          enrollment_id: string
          goal_id: string
          id: string
          new_rating: number | null
          note: string | null
          previous_rating: number | null
          source_activity_id: string
          source_activity_type: string
          submission_id: string | null
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          enrollment_id: string
          goal_id: string
          id?: string
          new_rating?: number | null
          note?: string | null
          previous_rating?: number | null
          source_activity_id: string
          source_activity_type: string
          submission_id?: string | null
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          enrollment_id?: string
          goal_id?: string
          id?: string
          new_rating?: number | null
          note?: string | null
          previous_rating?: number | null
          source_activity_id?: string
          source_activity_type?: string
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_checkins_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkins_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkins_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "coachee_goals"
            referencedColumns: ["id"]
          },
        ]
      }
      mentor_profiles: {
        Row: {
          bio: string | null
          coach_user_id: string
          created_at: string
          expertise_tags: string[]
          is_active: boolean
          updated_at: string
        }
        Insert: {
          bio?: string | null
          coach_user_id: string
          created_at?: string
          expertise_tags?: string[]
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          bio?: string | null
          coach_user_id?: string
          created_at?: string
          expertise_tags?: string[]
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentor_profiles_coach_user_id_fkey"
            columns: ["coach_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mentoring_allowlist: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mentee_user_id: string
          mentor_user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mentee_user_id: string
          mentor_user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mentee_user_id?: string
          mentor_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentoring_allowlist_mentor_user_id_fkey"
            columns: ["mentor_user_id"]
            isOneToOne: false
            referencedRelation: "mentor_profiles"
            referencedColumns: ["coach_user_id"]
          },
        ]
      }
      mentoring_feedback: {
        Row: {
          coaching_mindset: string | null
          created_at: string
          ethical_practice: string | null
          evokes_awareness: string | null
          facilitates_growth: string | null
          id: string
          listens_actively: string | null
          maintains_agreements: string | null
          maintains_presence: string | null
          mentee_id: string
          mentor_id: string
          mentoring_session_id: string
          overall_notes: string | null
          submitted_at: string
          submitted_by: string
          trust_safety: string | null
          updated_at: string
        }
        Insert: {
          coaching_mindset?: string | null
          created_at?: string
          ethical_practice?: string | null
          evokes_awareness?: string | null
          facilitates_growth?: string | null
          id?: string
          listens_actively?: string | null
          maintains_agreements?: string | null
          maintains_presence?: string | null
          mentee_id: string
          mentor_id: string
          mentoring_session_id: string
          overall_notes?: string | null
          submitted_at?: string
          submitted_by: string
          trust_safety?: string | null
          updated_at?: string
        }
        Update: {
          coaching_mindset?: string | null
          created_at?: string
          ethical_practice?: string | null
          evokes_awareness?: string | null
          facilitates_growth?: string | null
          id?: string
          listens_actively?: string | null
          maintains_agreements?: string | null
          maintains_presence?: string | null
          mentee_id?: string
          mentor_id?: string
          mentoring_session_id?: string
          overall_notes?: string | null
          submitted_at?: string
          submitted_by?: string
          trust_safety?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentoring_feedback_mentoring_session_id_fkey"
            columns: ["mentoring_session_id"]
            isOneToOne: true
            referencedRelation: "mentoring_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mentoring_sessions: {
        Row: {
          action_items: Json
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          confirmed_at: string | null
          created_at: string
          duration_minutes: number
          enrollment_id: string
          feedback_submitted_at: string | null
          id: string
          meeting_url: string | null
          mentee_id: string
          mentee_notes: string | null
          mentor_id: string
          mentor_notes: string | null
          prep_file_notes: string | null
          prep_file_path: string | null
          prep_file_submitted_at: string | null
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
          confirmed_at?: string | null
          created_at?: string
          duration_minutes: number
          enrollment_id: string
          feedback_submitted_at?: string | null
          id?: string
          meeting_url?: string | null
          mentee_id: string
          mentee_notes?: string | null
          mentor_id: string
          mentor_notes?: string | null
          prep_file_notes?: string | null
          prep_file_path?: string | null
          prep_file_submitted_at?: string | null
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
          confirmed_at?: string | null
          created_at?: string
          duration_minutes?: number
          enrollment_id?: string
          feedback_submitted_at?: string | null
          id?: string
          meeting_url?: string | null
          mentee_id?: string
          mentee_notes?: string | null
          mentor_id?: string
          mentor_notes?: string | null
          prep_file_notes?: string | null
          prep_file_path?: string | null
          prep_file_submitted_at?: string | null
          slot_id?: string | null
          start_time?: string
          status?: Database["public"]["Enums"]["session_status"]
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentoring_sessions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentoring_sessions_mentee_id_fkey"
            columns: ["mentee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentoring_sessions_mentor_id_fkey"
            columns: ["mentor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          body_vi: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          notification_type: string
          read_at: string | null
          title: string
          title_vi: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          body_vi?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          notification_type: string
          read_at?: string | null
          title: string
          title_vi?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          body_vi?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          notification_type?: string
          read_at?: string | null
          title?: string
          title_vi?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          account_manager_id: string | null
          admin_notes: string | null
          billing_contact: Json | null
          coaching_budget: number | null
          company_size: string | null
          contract_end: string | null
          contract_start: string | null
          created_at: string
          focus_competencies: string[] | null
          hq_country: string | null
          id: string
          industry: string | null
          locale: string | null
          logo_url: string | null
          name: string
          programme_objectives: string[] | null
          secondary_contact: Json | null
          subscription_tier: string | null
          timezone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          account_manager_id?: string | null
          admin_notes?: string | null
          billing_contact?: Json | null
          coaching_budget?: number | null
          company_size?: string | null
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string
          focus_competencies?: string[] | null
          hq_country?: string | null
          id?: string
          industry?: string | null
          locale?: string | null
          logo_url?: string | null
          name: string
          programme_objectives?: string[] | null
          secondary_contact?: Json | null
          subscription_tier?: string | null
          timezone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          account_manager_id?: string | null
          admin_notes?: string | null
          billing_contact?: Json | null
          coaching_budget?: number | null
          company_size?: string | null
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string
          focus_competencies?: string[] | null
          hq_country?: string | null
          id?: string
          industry?: string | null
          locale?: string | null
          logo_url?: string | null
          name?: string
          programme_objectives?: string[] | null
          secondary_contact?: Json | null
          subscription_tier?: string | null
          timezone?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_account_manager_id_fkey"
            columns: ["account_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          enrollment_id: string | null
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
          enrollment_id?: string | null
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
          enrollment_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "peer_sessions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
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
          must_change_password: boolean
          notification_prefs: Json
          onboarding_completed_at: string | null
          peer_coaching_opt_in: boolean
          preferred_language: string
          spoken_languages: string[]
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
          notification_prefs?: Json
          onboarding_completed_at?: string | null
          peer_coaching_opt_in?: boolean
          preferred_language?: string
          spoken_languages?: string[]
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
          notification_prefs?: Json
          onboarding_completed_at?: string | null
          peer_coaching_opt_in?: boolean
          preferred_language?: string
          spoken_languages?: string[]
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      programme_enrollments: {
        Row: {
          coachee_id: string | null
          cohort_id: string | null
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string | null
          programme_id: string
          progress_pct: number | null
          start_date: string
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          coachee_id?: string | null
          cohort_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          programme_id: string
          progress_pct?: number | null
          start_date?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          coachee_id?: string | null
          cohort_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          programme_id?: string
          progress_pct?: number | null
          start_date?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          updated_at?: string
          user_id?: string
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
            foreignKeyName: "programme_enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_enrollments_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_enrollments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      programme_modules: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          module: Database["public"]["Enums"]["programme_module_type"]
          programme_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          module: Database["public"]["Enums"]["programme_module_type"]
          programme_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          module?: Database["public"]["Enums"]["programme_module_type"]
          programme_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_modules_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      programme_reflections: {
        Row: {
          appears_at_week: number
          created_at: string
          id: string
          instructions: string | null
          instructions_vi: string | null
          is_visible: boolean
          programme_id: string
          reflection_number: number
          title: string
          title_vi: string | null
          updated_at: string
        }
        Insert: {
          appears_at_week: number
          created_at?: string
          id?: string
          instructions?: string | null
          instructions_vi?: string | null
          is_visible?: boolean
          programme_id: string
          reflection_number: number
          title: string
          title_vi?: string | null
          updated_at?: string
        }
        Update: {
          appears_at_week?: number
          created_at?: string
          id?: string
          instructions?: string | null
          instructions_vi?: string | null
          is_visible?: boolean
          programme_id?: string
          reflection_number?: number
          title?: string
          title_vi?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_reflections_programme_id_fkey"
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
          mentoring_received_limit: number | null
          name: string
          peer_given_limit: number
          peer_session_limit: number
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
          mentoring_received_limit?: number | null
          name: string
          peer_given_limit?: number
          peer_session_limit?: number
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
          mentoring_received_limit?: number | null
          name?: string
          peer_given_limit?: number
          peer_session_limit?: number
          updated_at?: string
        }
        Relationships: []
      }
      quiz_questions: {
        Row: {
          assignment_id: string
          created_at: string
          explanation: string | null
          explanation_vi: string | null
          id: string
          options: Json
          question_text: string
          question_text_vi: string | null
          sort_order: number
        }
        Insert: {
          assignment_id: string
          created_at?: string
          explanation?: string | null
          explanation_vi?: string | null
          id?: string
          options?: Json
          question_text: string
          question_text_vi?: string | null
          sort_order?: number
        }
        Update: {
          assignment_id?: string
          created_at?: string
          explanation?: string | null
          explanation_vi?: string | null
          id?: string
          options?: Json
          question_text?: string
          question_text_vi?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      reflection_answers: {
        Row: {
          answer_text: string | null
          answer_value: number | null
          created_at: string
          id: string
          question_id: string
          submission_id: string
        }
        Insert: {
          answer_text?: string | null
          answer_value?: number | null
          created_at?: string
          id?: string
          question_id: string
          submission_id: string
        }
        Update: {
          answer_text?: string | null
          answer_value?: number | null
          created_at?: string
          id?: string
          question_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reflection_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "reflection_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reflection_answers_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "reflection_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      reflection_questions: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          question_text: string
          question_text_vi: string | null
          question_type: string
          reflection_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          question_text: string
          question_text_vi?: string | null
          question_type: string
          reflection_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          question_text?: string
          question_text_vi?: string | null
          question_type?: string
          reflection_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "reflection_questions_reflection_id_fkey"
            columns: ["reflection_id"]
            isOneToOne: false
            referencedRelation: "programme_reflections"
            referencedColumns: ["id"]
          },
        ]
      }
      reflection_submissions: {
        Row: {
          confidence_score: number
          enrollment_id: string
          id: string
          reflection_id: string
          submitted_at: string
          user_id: string
        }
        Insert: {
          confidence_score: number
          enrollment_id: string
          id?: string
          reflection_id: string
          submitted_at?: string
          user_id: string
        }
        Update: {
          confidence_score?: number
          enrollment_id?: string
          id?: string
          reflection_id?: string
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reflection_submissions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reflection_submissions_reflection_id_fkey"
            columns: ["reflection_id"]
            isOneToOne: false
            referencedRelation: "programme_reflections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reflection_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_activity_attributions: {
        Row: {
          attributed_at: string
          enrollment_id: string
          id: string
          milestone_id: string | null
          module: Database["public"]["Enums"]["programme_module_type"]
          occurred_on: string
          source_activity_id: string
          source_activity_type: string
        }
        Insert: {
          attributed_at?: string
          enrollment_id: string
          id?: string
          milestone_id?: string | null
          module: Database["public"]["Enums"]["programme_module_type"]
          occurred_on: string
          source_activity_id: string
          source_activity_type: string
        }
        Update: {
          attributed_at?: string
          enrollment_id?: string
          id?: string
          milestone_id?: string | null
          module?: Database["public"]["Enums"]["programme_module_type"]
          occurred_on?: string
          source_activity_id?: string
          source_activity_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_activity_attributions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_activity_attributions_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "enrollment_module_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      session_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          peer_session_id: string | null
          session_id: string | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          peer_session_id?: string | null
          session_id?: string | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          peer_session_id?: string | null
          session_id?: string | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attachments_peer_session_id_fkey"
            columns: ["peer_session_id"]
            isOneToOne: false
            referencedRelation: "peer_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attachments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_goal_ratings: {
        Row: {
          coachee_id: string
          created_at: string
          goal_id: string
          id: string
          note: string | null
          rating: number
          session_id: string
          updated_at: string
        }
        Insert: {
          coachee_id: string
          created_at?: string
          goal_id: string
          id?: string
          note?: string | null
          rating: number
          session_id: string
          updated_at?: string
        }
        Update: {
          coachee_id?: string
          created_at?: string
          goal_id?: string
          id?: string
          note?: string | null
          rating?: number
          session_id?: string
          updated_at?: string
        }
        Relationships: []
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
          enrollment_id: string | null
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
          enrollment_id?: string | null
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
          enrollment_id?: string | null
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
          {
            foreignKeyName: "sessions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_profiles: {
        Row: {
          created_at: string
          department: string | null
          organization_id: string
          phone: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          organization_id: string
          phone?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string | null
          organization_id?: string
          phone?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_report_requests: {
        Row: {
          admin_notes: string | null
          cohort_id: string
          created_at: string
          id: string
          organization_id: string
          request_notes: string | null
          requested_by: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_notes?: string | null
          cohort_id: string
          created_at?: string
          id?: string
          organization_id: string
          request_notes?: string | null
          requested_by: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_notes?: string | null
          cohort_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          request_notes?: string | null
          requested_by?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_report_requests_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_report_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_report_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_report_requests_updated_by_fkey"
            columns: ["updated_by"]
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
      tool_sessions: {
        Row: {
          created_at: string
          filled_by: string
          id: string
          peer_session_id: string | null
          responses: Json
          session_id: string | null
          tool_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          filled_by: string
          id?: string
          peer_session_id?: string | null
          responses?: Json
          session_id?: string | null
          tool_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          filled_by?: string
          id?: string
          peer_session_id?: string | null
          responses?: Json
          session_id?: string | null
          tool_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_sessions_peer_session_id_fkey"
            columns: ["peer_session_id"]
            isOneToOne: false
            referencedRelation: "peer_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_sessions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      training_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          enrollment_id: string
          id: string
          pdf_downloaded_at: string | null
          training_week_id: string
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          enrollment_id: string
          id?: string
          pdf_downloaded_at?: string | null
          training_week_id: string
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          enrollment_id?: string
          id?: string
          pdf_downloaded_at?: string | null
          training_week_id?: string
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_progress_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_progress_training_week_id_fkey"
            columns: ["training_week_id"]
            isOneToOne: false
            referencedRelation: "training_weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_weeks: {
        Row: {
          created_at: string
          id: string
          is_visible: boolean
          pdf_storage_path: string | null
          pdf_storage_path_vi: string | null
          programme_id: string
          skill_card_html: string | null
          skill_card_html_vi: string | null
          skill_card_visible: boolean
          sort_order: number
          subtitle: string | null
          subtitle_vi: string | null
          title: string
          title_vi: string | null
          unlock_date: string | null
          updated_at: string
          video_url: string | null
          week_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible?: boolean
          pdf_storage_path?: string | null
          pdf_storage_path_vi?: string | null
          programme_id: string
          skill_card_html?: string | null
          skill_card_html_vi?: string | null
          skill_card_visible?: boolean
          sort_order?: number
          subtitle?: string | null
          subtitle_vi?: string | null
          title: string
          title_vi?: string | null
          unlock_date?: string | null
          updated_at?: string
          video_url?: string | null
          week_number: number
        }
        Update: {
          created_at?: string
          id?: string
          is_visible?: boolean
          pdf_storage_path?: string | null
          pdf_storage_path_vi?: string | null
          programme_id?: string
          skill_card_html?: string | null
          skill_card_html_vi?: string | null
          skill_card_visible?: boolean
          sort_order?: number
          subtitle?: string | null
          subtitle_vi?: string | null
          title?: string
          title_vi?: string | null
          unlock_date?: string | null
          updated_at?: string
          video_url?: string | null
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_weeks_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_alternative_proposal_responses: {
        Row: {
          enrollment_id: string
          proposal_id: string
          responded_at: string | null
          response: string
        }
        Insert: {
          enrollment_id: string
          proposal_id: string
          responded_at?: string | null
          response?: string
        }
        Update: {
          enrollment_id?: string
          proposal_id?: string
          responded_at?: string | null
          response?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_alternative_proposal_responses_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triad_alternative_proposal_responses_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "triad_alternative_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_alternative_proposals: {
        Row: {
          created_at: string
          id: string
          proposed_by_enrollment_id: string | null
          proposed_end_time: string
          proposed_start_time: string
          status: string
          triad_session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          proposed_by_enrollment_id?: string | null
          proposed_end_time: string
          proposed_start_time: string
          status?: string
          triad_session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          proposed_by_enrollment_id?: string | null
          proposed_end_time?: string
          proposed_start_time?: string
          status?: string
          triad_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_alternative_proposals_proposed_by_enrollment_id_fkey"
            columns: ["proposed_by_enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triad_alternative_proposals_triad_session_id_fkey"
            columns: ["triad_session_id"]
            isOneToOne: false
            referencedRelation: "triad_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_cutover_archive: {
        Row: {
          archived_at: string
          migration_id: string
          object_name: string
          payload: Json
          record_id: string
        }
        Insert: {
          archived_at?: string
          migration_id: string
          object_name: string
          payload: Json
          record_id: string
        }
        Update: {
          archived_at?: string
          migration_id?: string
          object_name?: string
          payload?: Json
          record_id?: string
        }
        Relationships: []
      }
      triad_cutover_group_decisions: {
        Row: {
          cohort_requirement_date_id: string | null
          decided_at: string
          decision: string
          evidence: Json
          migration_id: string
          reason: string
          triad_group_id: string
        }
        Insert: {
          cohort_requirement_date_id?: string | null
          decided_at?: string
          decision: string
          evidence?: Json
          migration_id: string
          reason: string
          triad_group_id: string
        }
        Update: {
          cohort_requirement_date_id?: string | null
          decided_at?: string
          decision?: string
          evidence?: Json
          migration_id?: string
          reason?: string
          triad_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_cutover_group_decisions_cohort_requirement_date_id_fkey"
            columns: ["cohort_requirement_date_id"]
            isOneToOne: false
            referencedRelation: "cohort_requirement_dates"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_group_members: {
        Row: {
          created_at: string
          enrollment_id: string
          id: string
          member_order: number
          triad_group_id: string
        }
        Insert: {
          created_at?: string
          enrollment_id: string
          id?: string
          member_order: number
          triad_group_id: string
        }
        Update: {
          created_at?: string
          enrollment_id?: string
          id?: string
          member_order?: number
          triad_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_group_members_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triad_group_members_triad_group_id_fkey"
            columns: ["triad_group_id"]
            isOneToOne: false
            referencedRelation: "triad_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_groups: {
        Row: {
          assigned_by: string
          cohort_requirement_date_id: string | null
          created_at: string
          group_language: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          assigned_by?: string
          cohort_requirement_date_id?: string | null
          created_at?: string
          group_language?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          assigned_by?: string
          cohort_requirement_date_id?: string | null
          created_at?: string
          group_language?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_groups_cohort_requirement_date_id_fkey"
            columns: ["cohort_requirement_date_id"]
            isOneToOne: false
            referencedRelation: "cohort_requirement_dates"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_reflection_answers: {
        Row: {
          answer_text: string
          created_at: string
          id: string
          question_id: string
          triad_reflection_id: string
        }
        Insert: {
          answer_text: string
          created_at?: string
          id?: string
          question_id: string
          triad_reflection_id: string
        }
        Update: {
          answer_text?: string
          created_at?: string
          id?: string
          question_id?: string
          triad_reflection_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_reflection_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "triad_reflection_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triad_reflection_answers_triad_reflection_id_fkey"
            columns: ["triad_reflection_id"]
            isOneToOne: false
            referencedRelation: "triad_reflections"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_reflection_questions: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          label: string
          label_vi: string | null
          programme_id: string | null
          question_key: string
          section: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order: number
          id?: string
          is_active?: boolean
          label: string
          label_vi?: string | null
          programme_id?: string | null
          question_key: string
          section: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label?: string
          label_vi?: string | null
          programme_id?: string | null
          question_key?: string
          section?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_reflection_questions_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_reflections: {
        Row: {
          enrollment_id: string | null
          id: string
          satisfaction_rating: number | null
          submitted_at: string
          triad_session_id: string
        }
        Insert: {
          enrollment_id?: string | null
          id?: string
          satisfaction_rating?: number | null
          submitted_at?: string
          triad_session_id: string
        }
        Update: {
          enrollment_id?: string | null
          id?: string
          satisfaction_rating?: number | null
          submitted_at?: string
          triad_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_reflections_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triad_reflections_triad_session_id_fkey"
            columns: ["triad_session_id"]
            isOneToOne: false
            referencedRelation: "triad_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_session_responses: {
        Row: {
          enrollment_id: string
          responded_at: string | null
          response: string
          triad_session_id: string
        }
        Insert: {
          enrollment_id: string
          responded_at?: string | null
          response?: string
          triad_session_id: string
        }
        Update: {
          enrollment_id?: string
          responded_at?: string | null
          response?: string
          triad_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_session_responses_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "programme_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triad_session_responses_triad_session_id_fkey"
            columns: ["triad_session_id"]
            isOneToOne: false
            referencedRelation: "triad_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      triad_sessions: {
        Row: {
          created_at: string
          id: string
          meeting_url: string | null
          notes: string | null
          scheduled_end_time: string | null
          scheduled_start_time: string | null
          status: string
          triad_group_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          meeting_url?: string | null
          notes?: string | null
          scheduled_end_time?: string | null
          scheduled_start_time?: string | null
          status?: string
          triad_group_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          meeting_url?: string | null
          notes?: string | null
          scheduled_end_time?: string | null
          scheduled_start_time?: string | null
          status?: string
          triad_group_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "triad_sessions_triad_group_id_fkey"
            columns: ["triad_group_id"]
            isOneToOne: false
            referencedRelation: "triad_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      user_module_access: {
        Row: {
          enabled: boolean
          module: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          enabled?: boolean
          module: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          enabled?: boolean
          module?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_module_access_user_id_fkey"
            columns: ["user_id"]
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
      enrollment_ongoing_conflicts: {
        Row: {
          enrollment_ids: string[] | null
          statuses: Database["public"]["Enums"]["enrollment_status"][] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programme_enrollments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_scope_backfill_audit: {
        Row: {
          candidate_enrollments: number | null
          record_id: string | null
          table_name: string | null
          unresolved_reason: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_canonical_enrollment_journey: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: Json
      }
      admin_canonical_enrollment_progress: {
        Args: { p_as_of?: string; p_enrollment_ids: string[] }
        Returns: {
          booked_units: number
          coaching_booked_units: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_id: string
          cohort_label: string
          completed_units: number
          due_adherence_pct: number
          due_units: number
          effective_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          enrollment_end_date: string
          enrollment_id: string
          enrollment_start_date: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          full_completion_pct: number
          learner_display_name: string
          mentoring_booked_units: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          overdue_units: number
          pace_status: string
          peer_booked_units: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          programme_end_date: string
          programme_id: string
          programme_label: string
          programme_start_date: string
          progress_available: boolean
          required_units: number
          stored_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          training_booked_units: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      admin_canonical_schedule_state: {
        Args: { p_enrollment_id: string }
        Returns: {
          module: Database["public"]["Enums"]["programme_module_type"]
          required_units: number
          scheduled_units: number
          state: string
        }[]
      }
      admin_cohort_triad_requirements: {
        Args: { p_as_of?: string; p_cohort_id: string }
        Returns: {
          assigned_enrollments: number
          assignment_status: string
          cohort_requirement_date_id: string
          completed_enrollments: number
          due_on: string
          eligible_enrollments: number
          groups: Json
          is_operational: boolean
          last_assignment_run_at: string
          last_assignment_summary: Json
          overdue_enrollments: number
          programme_id: string
          required_units: number
          unit_number: number
        }[]
      }
      admin_create_programme_enrollment: {
        Args: {
          p_cohort_id: string
          p_end_date?: string
          p_organization_id: string
          p_programme_id: string
          p_start_date?: string
          p_user_id: string
        }
        Returns: {
          coachee_id: string | null
          cohort_id: string | null
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string | null
          programme_id: string
          progress_pct: number | null
          start_date: string
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "programme_enrollments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_list_report_requests: {
        Args: never
        Returns: {
          admin_notes: string
          cohort_id: string
          cohort_name: string
          created_at: string
          id: string
          organization_id: string
          organization_name: string
          request_notes: string
          requested_by: string
          requester_name: string
          status: string
          updated_at: string
          updated_by: string
        }[]
      }
      admin_save_cohort_requirement_dates: {
        Args: { p_cohort_id: string; p_items: Json; p_regenerate?: boolean }
        Returns: number
      }
      admin_triad_change_member: {
        Args: {
          p_add_enrollment_id?: string
          p_group_id: string
          p_remove_enrollment_id?: string
        }
        Returns: undefined
      }
      admin_triad_create_group: {
        Args: {
          p_cohort_requirement_date_id: string
          p_enrollment_ids: string[]
          p_group_language: string
        }
        Returns: string
      }
      admin_triad_requirement_candidates: {
        Args: { p_cohort_requirement_date_id: string }
        Returns: {
          enrollment_id: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          full_name: string
          spoken_languages: string[]
          triad_group_id: string
          user_id: string
        }[]
      }
      admin_triad_set_group_active: {
        Args: { p_group_id: string; p_is_active: boolean }
        Returns: undefined
      }
      admin_update_coach_configuration: {
        Args: {
          p_coach_id: string
          p_cohort_id?: string
          p_enrollment_id?: string
          p_full_name: string
          p_organization_id?: string
          p_profile_status: string
          p_programme_id?: string
          p_selectable_coach_ids?: string[]
        }
        Returns: undefined
      }
      admin_update_report_request: {
        Args: { p_admin_notes?: string; p_request_id: string; p_status: string }
        Returns: {
          admin_notes: string | null
          cohort_id: string
          created_at: string
          id: string
          organization_id: string
          request_notes: string | null
          requested_by: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sponsor_report_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_enrollment_schedule_backfill_ready: {
        Args: never
        Returns: undefined
      }
      assert_enrollment_scope: {
        Args: {
          p_cohort_id?: string
          p_enrollment_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      attribute_activity_to_cadence_milestone: {
        Args: {
          p_activity_id: string
          p_enrollment_id: string
          p_module: string
          p_occurred_on: string
        }
        Returns: string
      }
      backfill_coachee_reflection_enrollment_scope: {
        Args: never
        Returns: {
          ambiguous_count: number
          resolved_count: number
        }[]
      }
      backfill_enrollment_actions: { Args: never; Returns: number }
      backfill_enrollment_schedule_snapshots: {
        Args: { p_limit?: number }
        Returns: {
          processed: number
          skipped: number
          succeeded: number
          unresolved: number
        }[]
      }
      book_coachee_peer_session: {
        Args: {
          p_duration_minutes: number
          p_enrollment_id: string
          p_provider_id: string
          p_slot_id?: string
          p_start_time: string
          p_topic: string
        }
        Returns: string
      }
      book_peer_session: {
        Args: {
          p_duration_minutes: number
          p_enrollment_id: string
          p_peer_coach_id: string
          p_slot_id?: string
          p_start_time: string
          p_topic: string
        }
        Returns: string
      }
      bulk_create_availability: {
        Args: {
          _coach_id: string
          _start_date: string
          _template: Json
          _weeks: number
        }
        Returns: number
      }
      can_book_coachee_peer_session: {
        Args: { p_enrollment_id: string; p_provider_id: string }
        Returns: boolean
      }
      can_book_mentoring_session:
        | {
            Args: { p_mentee_id: string; p_mentor_id: string }
            Returns: boolean
          }
        | {
            Args: {
              p_enrollment_id: string
              p_mentee_id: string
              p_mentor_id: string
            }
            Returns: boolean
          }
      can_book_mentoring_session_reason:
        | {
            Args: { p_mentee_id: string; p_mentor_id: string }
            Returns: string
          }
        | {
            Args: {
              p_enrollment_id: string
              p_mentee_id: string
              p_mentor_id: string
            }
            Returns: string
          }
      can_book_peer_session: {
        Args: { p_enrollment_id: string; p_peer_coach_id: string }
        Returns: boolean
      }
      can_book_session:
        | {
            Args: { p_coach_id: string; p_coachee_id: string }
            Returns: boolean
          }
        | {
            Args: {
              p_coach_id: string
              p_coachee_id: string
              p_enrollment_id: string
            }
            Returns: boolean
          }
      can_manage_enrollment_activity: {
        Args: {
          p_enrollment_id: string
          p_source_activity_id: string
          p_source_activity_type: string
        }
        Returns: boolean
      }
      can_message_peer_session: {
        Args: { _peer_session_id: string; _user_id: string }
        Returns: boolean
      }
      can_message_session: {
        Args: { _session_id: string; _user_id: string }
        Returns: boolean
      }
      canonical_enrollment_engagement: {
        Args: { p_enrollment_id: string }
        Returns: {
          action_completion_pct: number
          completed_action_count: number
          goal_count: number
          goal_progress_pct: number
          goal_setup: boolean
          open_action_count: number
          satisfaction_avg: number
          satisfaction_rated_count: number
          total_action_count: number
        }[]
      }
      canonical_enrollment_experience: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: Json
      }
      canonical_enrollment_experience_base: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: Json
      }
      canonical_enrollment_journey: {
        Args: { p_as_of: string; p_enrollment_id: string }
        Returns: Json
      }
      canonical_enrollment_progress: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          booked_units: number
          coaching_booked_units: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_id: string
          cohort_label: string
          completed_units: number
          due_adherence_pct: number
          due_units: number
          effective_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          enrollment_end_date: string
          enrollment_id: string
          enrollment_start_date: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          full_completion_pct: number
          learner_display_name: string
          mentoring_booked_units: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          overdue_units: number
          pace_status: string
          peer_booked_units: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          programme_end_date: string
          programme_id: string
          programme_label: string
          programme_start_date: string
          progress_available: boolean
          required_units: number
          stored_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          training_booked_units: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      canonical_enrollment_schedule_state: {
        Args: { p_enrollment_id: string }
        Returns: {
          module: Database["public"]["Enums"]["programme_module_type"]
          required_units: number
          scheduled_units: number
          state: string
        }[]
      }
      canonical_goal_progress: {
        Args: { p_enrollment_id: string }
        Returns: {
          current_rating: number
          goal_id: string
          has_rating: boolean
          progress_pct: number
          start_rating: number
          target_rating: number
        }[]
      }
      canonical_learning_breakdown: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: Json
      }
      canonical_module_progress: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          booked_units: number
          completed_activity_units: number
          completed_units: number
          due_units: number
          module: Database["public"]["Enums"]["programme_module_type"]
          overdue_units: number
          pace_status: string
          required_units: number
        }[]
      }
      canonical_training_learning_items: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          completed_on: string
          completed_units: number
          due_on: string
          item_id: string
          item_type: string
          required_units: number
          training_week_id: string
        }[]
      }
      canonical_training_learning_summary: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          completed_due_units: number
          completed_units: number
          configured_required_units: number
          due_units: number
          overdue_units: number
          required_units: number
          requirement_mismatch: boolean
        }[]
      }
      canonical_triad_group_members: {
        Args: { p_group_ids: string[] }
        Returns: {
          avatar_url: string
          full_name: string
          member_id: string
          member_slot: number
          triad_group_id: string
        }[]
      }
      check_can_book_mentoring_session: {
        Args: { p_mentor_id: string }
        Returns: boolean
      }
      check_can_book_mentoring_session_reason:
        | { Args: { p_mentor_id: string }; Returns: string }
        | {
            Args: { p_enrollment_id: string; p_mentor_id: string }
            Returns: string
          }
      check_can_book_mentoring_session_reason_for_enrollment: {
        Args: { p_enrollment_id: string; p_mentor_id: string }
        Returns: string
      }
      check_can_book_session:
        | { Args: { p_coach_id: string }; Returns: boolean }
        | {
            Args: { p_coach_id: string; p_enrollment_id?: string }
            Returns: boolean
          }
      check_has_module_access: { Args: { p_module: string }; Returns: boolean }
      check_mentoring_given_usage: {
        Args: { p_mentor_id: string }
        Returns: {
          limit_count: number
          used_count: number
        }[]
      }
      check_mentoring_session_usage:
        | {
            Args: never
            Returns: {
              limit_count: number
              used_count: number
            }[]
          }
        | {
            Args: { p_enrollment_id: string }
            Returns: {
              limit_count: number
              used_count: number
            }[]
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
      cohort_programme_schedule_state: {
        Args: { p_cohort_id: string; p_programme_id: string }
        Returns: {
          module: Database["public"]["Enums"]["programme_module_type"]
          required_units: number
          scheduled_units: number
          state: string
        }[]
      }
      cohort_requirement_proposal_internal: {
        Args: {
          p_cohort_id: string
          p_end: string
          p_programme_id: string
          p_start: string
        }
        Returns: {
          due_on: string
          generation_method: string
          module: Database["public"]["Enums"]["programme_module_type"]
          ordinal: number
          training_week_id: string
          units: number
        }[]
      }
      cohort_requirement_schedule_issues: {
        Args: { p_cohort_id: string }
        Returns: {
          issue: string
          module: Database["public"]["Enums"]["programme_module_type"]
          programme_id: string
          required_units: number
          scheduled_units: number
        }[]
      }
      cohort_requirement_schedule_proposal: {
        Args: {
          p_cohort_id?: string
          p_end: string
          p_programme_id: string
          p_start: string
        }
        Returns: {
          due_on: string
          generation_method: string
          module: Database["public"]["Enums"]["programme_module_type"]
          ordinal: number
          programme_id: string
          training_week_id: string
          units: number
        }[]
      }
      cohort_scheduled_programmes: {
        Args: { p_cohort_id: string }
        Returns: {
          programme_id: string
        }[]
      }
      create_programme_enrollment: {
        Args: {
          p_cohort_id: string
          p_end_date?: string
          p_organization_id: string
          p_programme_id: string
          p_start_date?: string
          p_user_id: string
        }
        Returns: {
          coachee_id: string | null
          cohort_id: string | null
          created_at: string
          end_date: string | null
          id: string
          notes: string | null
          organization_id: string | null
          programme_id: string
          progress_pct: number | null
          start_date: string
          status: Database["public"]["Enums"]["enrollment_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "programme_enrollments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dashboard_summary: { Args: { p_user_id: string }; Returns: Json }
      enrollment_activity_participants: {
        Args: {
          p_enrollment_id: string
          p_source_activity_id: string
          p_source_activity_type: string
        }
        Returns: {
          learner_id: string
          provider_id: string
        }[]
      }
      enrollment_module_config: {
        Args: {
          p_enrollment_id: string
          p_module: Database["public"]["Enums"]["programme_module_type"]
        }
        Returns: Json
      }
      generate_enrollment_schedule: {
        Args: { p_enrollment_id: string }
        Returns: undefined
      }
      get_coach_peer_session_usage: {
        Args: { _coach_id: string }
        Returns: {
          peer_monthly_limit: number
          used_this_month: number
        }[]
      }
      get_coachee_peer_session_usage: {
        Args: { p_enrollment_id: string }
        Returns: {
          receive_limit: number
          used_count: number
        }[]
      }
      get_coachee_session_usage_for_enrollment: {
        Args: { p_enrollment_id: string }
        Returns: {
          monthly_limit: number
          used_this_month: number
        }[]
      }
      get_enrollment_programme_modules: {
        Args: { p_enrollment_id: string }
        Returns: {
          config: Json
          enabled: boolean
          module: Database["public"]["Enums"]["programme_module_type"]
        }[]
      }
      get_enrollment_progress: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          booked_units: number
          completed_units: number
          due_adherence_pct: number
          due_units: number
          full_completion_pct: number
          module: Database["public"]["Enums"]["programme_module_type"]
          pace_status: string
          required_units: number
        }[]
      }
      get_enrollment_training_weeks: {
        Args: { p_enrollment_id: string }
        Returns: {
          completed_at: string
          effective_unlock_date: string
          id: string
          locked: boolean
          skill_card_visible: boolean
          subtitle: string
          subtitle_vi: string
          title: string
          title_vi: string
          unlock_date: string
          viewed_at: string
          week_number: number
        }[]
      }
      get_mentoring_given_limit: {
        Args: { p_mentor_id: string }
        Returns: number
      }
      get_mentoring_given_usage: {
        Args: { p_mentor_id: string }
        Returns: {
          limit_count: number
          used_count: number
        }[]
      }
      get_mentoring_received_limit: {
        Args: { p_user_id: string }
        Returns: number
      }
      get_mentoring_session_usage: {
        Args: { p_enrollment_id: string }
        Returns: {
          limit_count: number
          used_count: number
        }[]
      }
      get_mentoring_session_usage_for_enrollment: {
        Args: { p_enrollment_id: string }
        Returns: {
          limit_count: number
          used_count: number
        }[]
      }
      get_my_mentors: {
        Args: never
        Returns: {
          avatar_url: string
          bio: string
          expertise_tags: string[]
          full_name: string
          mentor_user_id: string
        }[]
      }
      get_my_programme_modules: {
        Args: never
        Returns: {
          config: Json
          enabled: boolean
          module: Database["public"]["Enums"]["programme_module_type"]
        }[]
      }
      get_my_training_weeks: {
        Args: never
        Returns: {
          completed_at: string
          effective_unlock_date: string
          id: string
          locked: boolean
          skill_card_visible: boolean
          subtitle: string
          subtitle_vi: string
          title: string
          title_vi: string
          unlock_date: string
          viewed_at: string
          week_number: number
        }[]
      }
      get_own_coach_invite_slots: {
        Args: never
        Returns: {
          invite_limit: number
          used_slots: number
        }[]
      }
      get_peer_session_usage: {
        Args: { p_enrollment_id: string }
        Returns: {
          monthly_limit: number
          used_count: number
        }[]
      }
      get_primary_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_quiz_questions: {
        Args: { p_assignment_id: string }
        Returns: {
          explanation: string
          explanation_vi: string
          id: string
          options: Json
          question_text: string
          question_text_vi: string
          sort_order: number
        }[]
      }
      get_sponsor_org: { Args: { _user_id: string }; Returns: string }
      get_sponsor_programme_journey: {
        Args: { p_as_of?: string; p_cohort_id: string }
        Returns: Json
      }
      get_sponsor_programme_progress: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          booked_units: number
          completed_activity_units: number
          completed_units: number
          due_units: number
          module: Database["public"]["Enums"]["programme_module_type"]
          pace_status: string
          required_units: number
        }[]
      }
      get_todays_prompt: {
        Args: never
        Returns: {
          already_responded: boolean
          prompt_id: string
          prompt_text: string
          prompt_text_vi: string
          response_text: string
          week_number: number
          week_title: string
          week_title_vi: string
        }[]
      }
      has_module_access: {
        Args: { p_module: string; p_user_id: string }
        Returns: boolean
      }
      has_programme_module: {
        Args: { p_module: Database["public"]["Enums"]["programme_module_type"] }
        Returns: boolean
      }
      has_programme_module_direction: {
        Args: {
          p_direction: string
          p_module: Database["public"]["Enums"]["programme_module_type"]
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
      is_active_coach_profile: { Args: { _id: string }; Returns: boolean }
      is_allowlisted_pair: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
      is_coach_eligible: { Args: { p_coach_id: string }; Returns: boolean }
      is_historical_ownership_retired: {
        Args: { p_domain: string; p_record_id: string }
        Returns: boolean
      }
      is_triad_member: { Args: { group_id: string }; Returns: boolean }
      learner_canonical_engagement: {
        Args: { p_enrollment_id: string }
        Returns: {
          action_completion_pct: number
          completed_action_count: number
          goal_count: number
          goal_progress_pct: number
          goal_setup: boolean
          open_action_count: number
          satisfaction_avg: number
          satisfaction_rated_count: number
          total_action_count: number
        }[]
      }
      learner_canonical_experience: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: Json
      }
      learner_canonical_goal_progress: {
        Args: { p_enrollment_id: string }
        Returns: {
          current_rating: number
          goal_id: string
          has_rating: boolean
          progress_pct: number
          start_rating: number
          target_rating: number
        }[]
      }
      learner_canonical_journey: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: Json
      }
      learner_canonical_module_progress: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          booked_units: number
          completed_units: number
          due_adherence_pct: number
          due_units: number
          full_completion_pct: number
          module: Database["public"]["Enums"]["programme_module_type"]
          pace_status: string
          required_units: number
        }[]
      }
      learner_canonical_progress: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          booked_units: number
          coaching_booked_units: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_id: string
          cohort_label: string
          completed_units: number
          due_adherence_pct: number
          due_units: number
          effective_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          enrollment_end_date: string
          enrollment_id: string
          enrollment_start_date: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          full_completion_pct: number
          learner_display_name: string
          mentoring_booked_units: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          overdue_units: number
          pace_status: string
          peer_booked_units: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          programme_end_date: string
          programme_id: string
          programme_label: string
          programme_start_date: string
          progress_available: boolean
          required_units: number
          stored_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          training_booked_units: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      learner_canonical_schedule_state: {
        Args: { p_enrollment_id: string }
        Returns: {
          module: Database["public"]["Enums"]["programme_module_type"]
          required_units: number
          scheduled_units: number
          state: string
        }[]
      }
      learner_reflection_feed: {
        Args: { p_enrollment_id: string }
        Returns: {
          body: string
          details: Json
          is_private: boolean
          linked_activity_id: string
          linked_goal_id: string
          linked_session_id: string
          linked_session_table: string
          module: Database["public"]["Enums"]["programme_module_type"]
          occurred_at: string
          previous_rating: number
          rating: number
          reflection_key: string
          source_id: string
          source_table: string
          source_type: string
          title: string
        }[]
      }
      learner_session_history: {
        Args: { p_enrollment_id: string }
        Returns: {
          attributed_to_enrollment: boolean
          counterpart_names: string[]
          is_programme_evidence: boolean
          module: Database["public"]["Enums"]["programme_module_type"]
          participant_role: string
          round_number: number
          session_key: string
          session_type: string
          source_id: string
          source_table: string
          start_time: string
          status: string
          title: string
          training_week_number: number
        }[]
      }
      learner_triad_complete_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      learner_triad_members: {
        Args: { p_group_ids: string[] }
        Returns: {
          avatar_url: string
          full_name: string
          is_self: boolean
          member_id: string
          member_slot: number
          triad_group_id: string
        }[]
      }
      learner_triad_overview: {
        Args: { p_enrollment_id?: string }
        Returns: {
          cohort_requirement_date_id: string
          due_on: string
          enrollment_id: string
          group_language: string
          is_active: boolean
          member_count: number
          my_member_slot: number
          sessions: Json
          training_week_number: number
          training_week_title: string
          training_week_title_vi: string
          triad_group_id: string
          unit_completed: boolean
          unit_number: number
          unit_overdue: boolean
        }[]
      }
      learner_triad_propose_alternative: {
        Args: { p_end: string; p_session_id: string; p_start: string }
        Returns: string
      }
      learner_triad_reflection_questions: {
        Args: { p_session_id: string }
        Returns: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          label: string
          label_vi: string | null
          programme_id: string | null
          question_key: string
          section: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "triad_reflection_questions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      learner_triad_respond_alternative: {
        Args: { p_proposal_id: string; p_response: string }
        Returns: undefined
      }
      learner_triad_respond_session: {
        Args: { p_response: string; p_session_id: string }
        Returns: undefined
      }
      learner_triad_session_reflections: {
        Args: { p_session_id: string }
        Returns: {
          answers: Json
          is_self: boolean
          member_slot: number
          satisfaction_rating: number
          submitted_at: string
        }[]
      }
      learner_triad_submit_reflection: {
        Args: {
          p_answers?: Json
          p_satisfaction_rating?: number
          p_session_id: string
        }
        Returns: string
      }
      materialize_missing_cohort_requirement_dates: {
        Args: { p_cohort_id: string }
        Returns: number
      }
      only_enrollment_candidate: {
        Args: { p_on?: string; p_programme_id?: string; p_user_id: string }
        Returns: string
      }
      programme_config_integer: {
        Args: { p_config: Json; p_key: string }
        Returns: number
      }
      record_goal_checkin: {
        Args: {
          p_enrollment_id: string
          p_goal_id: string
          p_new_rating: number
          p_note?: string
          p_source_activity_id: string
          p_source_activity_type: string
        }
        Returns: {
          actor_user_id: string
          created_at: string
          enrollment_id: string
          goal_id: string
          id: string
          new_rating: number | null
          note: string | null
          previous_rating: number | null
          source_activity_id: string
          source_activity_type: string
          submission_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "goal_checkins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_goal_checkins: {
        Args: {
          p_checkins: Json
          p_enrollment_id: string
          p_source_activity_id: string
          p_source_activity_type: string
          p_submission_id?: string
        }
        Returns: {
          actor_user_id: string
          created_at: string
          enrollment_id: string
          goal_id: string
          id: string
          new_rating: number | null
          note: string | null
          previous_rating: number | null
          source_activity_id: string
          source_activity_type: string
          submission_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "goal_checkins"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      remove_own_coachee: { Args: { _coachee_id: string }; Returns: boolean }
      resolve_current_enrollment: {
        Args: { p_user_id: string }
        Returns: string
      }
      save_enrollment_activity_actions: {
        Args: {
          p_actions: Json
          p_enrollment_id: string
          p_source_activity_id: string
          p_source_activity_type: string
        }
        Returns: undefined
      }
      shares_session_with: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
      sponsor_canonical_activity: {
        Args: { p_enrollment_id: string }
        Returns: {
          module: Database["public"]["Enums"]["programme_module_type"]
          occurred_on: string
          status: string
        }[]
      }
      sponsor_canonical_cohort_progress: {
        Args: { p_as_of?: string; p_cohort_id?: string }
        Returns: {
          active_count: number
          ahead_count: number
          at_risk_count: number
          behind_count: number
          booked_units: number
          coaching_booked_units: number
          coaching_completed_leaders: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_id: string
          cohort_label: string
          completed_count: number
          completed_pace_count: number
          completed_units: number
          due_adherence_pct: number
          due_units: number
          enrollment_count: number
          full_completion_pct: number
          mentoring_booked_units: number
          mentoring_completed_leaders: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          not_yet_due_count: number
          on_track_count: number
          on_track_pct: number
          overdue_units: number
          pace_status: string
          paused_count: number
          peer_booked_units: number
          peer_completed_leaders: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          programme_end_date: string
          programme_journey: Json
          programme_label: string
          programme_start_date: string
          progress_source_complete: boolean
          required_units: number
          schedule_coverage_pct: number
          scheduled_count: number
          suppressed: boolean
          training_booked_units: number
          training_completed_leaders: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_leaders: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      sponsor_canonical_cohort_progress_one: {
        Args: { p_as_of?: string; p_cohort_id?: string }
        Returns: {
          active_count: number
          ahead_count: number
          at_risk_count: number
          behind_count: number
          booked_units: number
          coaching_booked_units: number
          coaching_completed_leaders: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_id: string
          cohort_label: string
          completed_count: number
          completed_pace_count: number
          completed_units: number
          due_adherence_pct: number
          due_units: number
          enrollment_count: number
          full_completion_pct: number
          mentoring_booked_units: number
          mentoring_completed_leaders: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          not_yet_due_count: number
          on_track_count: number
          on_track_pct: number
          overdue_units: number
          pace_status: string
          paused_count: number
          peer_booked_units: number
          peer_completed_leaders: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          programme_end_date: string
          programme_journey: Json
          programme_label: string
          programme_start_date: string
          progress_source_complete: boolean
          required_units: number
          schedule_coverage_pct: number
          scheduled_count: number
          suppressed: boolean
          training_booked_units: number
          training_completed_leaders: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_leaders: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      sponsor_canonical_enrollment_metadata: {
        Args: {
          p_as_of?: string
          p_cohort_id?: string
          p_enrollment_id?: string
        }
        Returns: {
          action_completion_pct: number
          booked_units: number
          coaching_booked_units: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_id: string
          cohort_label: string
          completed_action_count: number
          completed_units: number
          due_adherence_pct: number
          due_units: number
          effective_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          enrollment_end_date: string
          enrollment_id: string
          enrollment_start_date: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          full_completion_pct: number
          goal_count: number
          goal_progress_pct: number
          goal_setup: boolean
          learner_display_name: string
          mentoring_booked_units: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          open_action_count: number
          overdue_units: number
          pace_status: string
          peer_booked_units: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          programme_end_date: string
          programme_id: string
          programme_label: string
          programme_start_date: string
          progress_available: boolean
          required_units: number
          satisfaction_avg: number
          satisfaction_rated_count: number
          stored_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          total_action_count: number
          training_booked_units: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      sponsor_canonical_enrollment_progress: {
        Args: { p_as_of?: string; p_cohort_id?: string }
        Returns: {
          booked_units: number
          coaching_booked_units: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_id: string
          cohort_label: string
          completed_units: number
          due_adherence_pct: number
          due_units: number
          effective_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          enrollment_end_date: string
          enrollment_id: string
          enrollment_start_date: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          full_completion_pct: number
          learner_display_name: string
          mentoring_booked_units: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          overdue_units: number
          pace_status: string
          peer_booked_units: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          programme_end_date: string
          programme_id: string
          programme_label: string
          programme_start_date: string
          progress_available: boolean
          required_units: number
          stored_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          training_booked_units: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      sponsor_canonical_leader_experience: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: Json
      }
      sponsor_canonical_leader_journey: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: Json
      }
      sponsor_canonical_leader_progress: {
        Args: { p_as_of?: string; p_enrollment_id: string }
        Returns: {
          booked_units: number
          coaching_booked_units: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_id: string
          cohort_label: string
          completed_units: number
          due_adherence_pct: number
          due_units: number
          effective_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          enrollment_end_date: string
          enrollment_id: string
          enrollment_start_date: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          full_completion_pct: number
          learner_display_name: string
          mentoring_booked_units: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          overdue_units: number
          pace_status: string
          peer_booked_units: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          programme_end_date: string
          programme_id: string
          programme_label: string
          programme_start_date: string
          progress_available: boolean
          required_units: number
          stored_enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          training_booked_units: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      sponsor_canonical_leader_schedule_state: {
        Args: { p_enrollment_id: string }
        Returns: {
          module: Database["public"]["Enums"]["programme_module_type"]
          required_units: number
          scheduled_units: number
          state: string
        }[]
      }
      sponsor_canonical_module_schedule: {
        Args: { p_enrollment_id: string }
        Returns: {
          due_on: string
          milestone_units: number
          module: Database["public"]["Enums"]["programme_module_type"]
          required_units: number
          training_week_id: string
        }[]
      }
      sponsor_canonical_organisation_progress: {
        Args: { p_as_of?: string }
        Returns: {
          booked_units: number
          coaching_booked_units: number
          coaching_completed_units: number
          coaching_due_units: number
          coaching_required_units: number
          cohort_count: number
          completed_units: number
          due_adherence_pct: number
          due_units: number
          enrollment_count: number
          full_completion_pct: number
          mentoring_booked_units: number
          mentoring_completed_units: number
          mentoring_due_units: number
          mentoring_required_units: number
          overdue_units: number
          peer_booked_units: number
          peer_completed_units: number
          peer_due_units: number
          peer_required_units: number
          progress_source_complete: boolean
          required_units: number
          schedule_coverage_pct: number
          suppressed_cohort_count: number
          training_booked_units: number
          training_completed_units: number
          training_due_units: number
          training_required_units: number
          triad_booked_units: number
          triad_completed_units: number
          triad_due_units: number
          triad_required_units: number
        }[]
      }
      sponsor_canonical_programme_journey: {
        Args: { p_as_of?: string; p_cohort_id: string }
        Returns: Json
      }
      sponsor_list_report_requests: {
        Args: never
        Returns: {
          admin_notes: string | null
          cohort_id: string
          created_at: string
          id: string
          organization_id: string
          request_notes: string | null
          requested_by: string
          status: string
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "sponsor_report_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      sponsor_min_leaders_for_distribution: { Args: never; Returns: number }
      sponsor_submit_report_request: {
        Args: { p_cohort_id: string; p_request_notes?: string }
        Returns: {
          admin_notes: string | null
          cohort_id: string
          created_at: string
          id: string
          organization_id: string
          request_notes: string | null
          requested_by: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sponsor_report_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_session_status: {
        Args: {
          p_action: string
          p_kind: string
          p_reason?: string
          p_session_id: string
        }
        Returns: Database["public"]["Enums"]["session_status"]
      }
      triad_accept_proposal_if_unanimous: {
        Args: { p_proposal_id: string }
        Returns: undefined
      }
      triad_assert_admin: { Args: never; Returns: undefined }
      triad_caller_member_enrollment: {
        Args: { p_session_id: string }
        Returns: string
      }
      triad_clear_unconfirmed_auto_groups_internal: {
        Args: { p_cohort_requirement_date_id: string }
        Returns: number
      }
      triad_confirm_session_if_accepted: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      triad_create_group_internal: {
        Args: {
          p_assigned_by: string
          p_cohort_requirement_date_id: string
          p_end?: string
          p_enrollment_ids: string[]
          p_group_language: string
          p_start?: string
        }
        Returns: string
      }
      triad_group_is_historical_unlinked: {
        Args: { p_group_id: string }
        Returns: boolean
      }
      triad_group_sessions_internal: {
        Args: { p_group_id: string; p_viewer_enrollment_id: string }
        Returns: Json
      }
      triad_member_enrollment_for_user: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: string
      }
      triad_reflection_questions_for_session: {
        Args: { p_session_id: string }
        Returns: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          label: string
          label_vi: string | null
          programme_id: string | null
          question_key: string
          section: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "triad_reflection_questions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      triad_reflections_visible_to_group: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      triad_reminder_targets_internal: {
        Args: { p_as_of?: string; p_cohort_requirement_date_id?: string }
        Returns: {
          cohort_id: string
          cohort_requirement_date_id: string
          days_until_due: number
          due_on: string
          enrollment_id: string
          session_status: string
          triad_group_id: string
          unit_completed: boolean
          unit_number: number
          unit_overdue: boolean
          user_id: string
        }[]
      }
      triad_requirement_candidates_internal: {
        Args: { p_cohort_requirement_date_id: string }
        Returns: {
          enrollment_id: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          full_name: string
          spoken_languages: string[]
          triad_group_id: string
          user_id: string
        }[]
      }
      triad_requirement_units_internal: {
        Args: { p_cohort_id: string }
        Returns: {
          cohort_id: string
          cohort_requirement_date_id: string
          due_on: string
          is_operational: boolean
          programme_id: string
          required_units: number
          training_week_id: string
          unit_number: number
        }[]
      }
      triad_session_can_complete: {
        Args: { p_scheduled_start: string; p_status: string }
        Returns: boolean
      }
      triad_set_assignment_status_internal: {
        Args: {
          p_cohort_requirement_date_id: string
          p_status: string
          p_summary?: Json
        }
        Returns: undefined
      }
      triad_sync_session_attributions: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      triad_unit_enrollment_status_internal: {
        Args: { p_as_of?: string; p_cohort_requirement_date_id: string }
        Returns: {
          cohort_requirement_date_id: string
          due_on: string
          enrollment_id: string
          enrollment_status: Database["public"]["Enums"]["enrollment_status"]
          is_eligible: boolean
          scheduled_start_time: string
          session_id: string
          session_status: string
          triad_group_id: string
          unit_completed: boolean
          unit_number: number
          unit_overdue: boolean
          user_id: string
        }[]
      }
      update_session_notes: {
        Args: {
          p_field: string
          p_kind: string
          p_session_id: string
          p_value: string
        }
        Returns: undefined
      }
      validate_training_learning_requirements: {
        Args: { p_programme_id?: string }
        Returns: {
          active_required_child_units: number
          programme_id: string
          requirement_mismatch: boolean
          stored_required_units: number
        }[]
      }
    }
    Enums: {
      alert_severity: "info" | "warning" | "critical"
      app_role: "admin" | "coach" | "coachee" | "sponsor"
      assignment_type: "quiz" | "reflection"
      availability_slot_type: "coaching" | "peer" | "mentoring"
      enrollment_status: "active" | "completed" | "paused" | "at_risk"
      programme_module_type:
        | "coaching"
        | "peer_coaching"
        | "mentoring"
        | "triads"
        | "training"
        | "quiz"
        | "assessment"
        | "daily_prompt"
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
      alert_severity: ["info", "warning", "critical"],
      app_role: ["admin", "coach", "coachee", "sponsor"],
      assignment_type: ["quiz", "reflection"],
      availability_slot_type: ["coaching", "peer", "mentoring"],
      enrollment_status: ["active", "completed", "paused", "at_risk"],
      programme_module_type: [
        "coaching",
        "peer_coaching",
        "mentoring",
        "triads",
        "training",
        "quiz",
        "assessment",
        "daily_prompt",
      ],
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

