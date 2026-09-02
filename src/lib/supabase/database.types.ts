export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      audit_events: {
        Row: { action: string; actor_id: string | null; created_at: string; id: number; metadata: Json; target_id: string; target_type: string }
        Insert: { action: string; actor_id?: string | null; created_at?: string; id?: never; metadata?: Json; target_id: string; target_type: string }
        Update: { action?: string; actor_id?: string | null; created_at?: string; id?: never; metadata?: Json; target_id?: string; target_type?: string }
        Relationships: [{ foreignKeyName: "audit_events_actor_id_fkey"; columns: ["actor_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }]
      }
      companies: {
        Row: { company_type: string | null; created_at: string; created_by: string; description: string | null; fleet_summary: string | null; id: string; logo_path: string | null; name: string; office_locations: string[]; slug: string; updated_at: string; vessel_types: string[]; website: string | null }
        Insert: { company_type?: string | null; created_at?: string; created_by: string; description?: string | null; fleet_summary?: string | null; id?: string; logo_path?: string | null; name: string; office_locations?: string[]; slug: string; updated_at?: string; vessel_types?: string[]; website?: string | null }
        Update: { company_type?: string | null; created_at?: string; created_by?: string; description?: string | null; fleet_summary?: string | null; id?: string; logo_path?: string | null; name?: string; office_locations?: string[]; slug?: string; updated_at?: string; vessel_types?: string[]; website?: string | null }
        Relationships: [{ foreignKeyName: "companies_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }]
      }
      company_members: {
        Row: { approved_at: string | null; company_id: string; created_at: string; role: Database["public"]["Enums"]["company_member_role"]; user_id: string }
        Insert: { approved_at?: string | null; company_id: string; created_at?: string; role?: Database["public"]["Enums"]["company_member_role"]; user_id: string }
        Update: { approved_at?: string | null; company_id?: string; created_at?: string; role?: Database["public"]["Enums"]["company_member_role"]; user_id?: string }
        Relationships: [
          { foreignKeyName: "company_members_company_id_fkey"; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] },
          { foreignKeyName: "company_members_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      connections: {
        Row: { created_at: string; id: string; requested_by: string; responded_at: string | null; status: Database["public"]["Enums"]["connection_status"]; updated_at: string; user_high_id: string; user_low_id: string }
        Insert: { created_at?: string; id?: string; requested_by: string; responded_at?: string | null; status?: Database["public"]["Enums"]["connection_status"]; updated_at?: string; user_high_id: string; user_low_id: string }
        Update: { created_at?: string; id?: string; requested_by?: string; responded_at?: string | null; status?: Database["public"]["Enums"]["connection_status"]; updated_at?: string; user_high_id?: string; user_low_id?: string }
        Relationships: [
          { foreignKeyName: "connections_requested_by_fkey"; columns: ["requested_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "connections_user_high_id_fkey"; columns: ["user_high_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "connections_user_low_id_fkey"; columns: ["user_low_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      follows: {
        Row: { created_at: string; follower_id: string; following_id: string }
        Insert: { created_at?: string; follower_id: string; following_id: string }
        Update: { created_at?: string; follower_id?: string; following_id?: string }
        Relationships: [
          { foreignKeyName: "follows_follower_id_fkey"; columns: ["follower_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "follows_following_id_fkey"; columns: ["following_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      maritime_profiles: {
        Row: { availability: string | null; current_company: string | null; current_vessel: string | null; rank: string | null; sailing_experience_years: number | null; shore_career_preference: boolean; trading_areas: string[]; updated_at: string; user_id: string; vessel_types: string[] }
        Insert: { availability?: string | null; current_company?: string | null; current_vessel?: string | null; rank?: string | null; sailing_experience_years?: number | null; shore_career_preference?: boolean; trading_areas?: string[]; updated_at?: string; user_id: string; vessel_types?: string[] }
        Update: { availability?: string | null; current_company?: string | null; current_vessel?: string | null; rank?: string | null; sailing_experience_years?: number | null; shore_career_preference?: boolean; trading_areas?: string[]; updated_at?: string; user_id?: string; vessel_types?: string[] }
        Relationships: [{ foreignKeyName: "maritime_profiles_user_id_fkey"; columns: ["user_id"]; isOneToOne: true; referencedRelation: "profiles"; referencedColumns: ["id"] }]
      }
      notifications: {
        Row: { actor_id: string | null; connection_id: string | null; created_at: string; id: string; notification_type: Database["public"]["Enums"]["network_notification_type"]; read_at: string | null; recipient_id: string }
        Insert: { actor_id?: string | null; connection_id?: string | null; created_at?: string; id?: string; notification_type: Database["public"]["Enums"]["network_notification_type"]; read_at?: string | null; recipient_id: string }
        Update: { actor_id?: string | null; connection_id?: string | null; created_at?: string; id?: string; notification_type?: Database["public"]["Enums"]["network_notification_type"]; read_at?: string | null; recipient_id?: string }
        Relationships: [
          { foreignKeyName: "notifications_actor_id_fkey"; columns: ["actor_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "notifications_connection_id_fkey"; columns: ["connection_id"]; isOneToOne: false; referencedRelation: "connections"; referencedColumns: ["id"] },
          { foreignKeyName: "notifications_recipient_id_fkey"; columns: ["recipient_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      post_comments: {
        Row: { author_id: string; body: string; created_at: string; deleted_at: string | null; id: string; post_id: string; updated_at: string }
        Insert: { author_id: string; body: string; created_at?: string; deleted_at?: string | null; id?: string; post_id: string; updated_at?: string }
        Update: { author_id?: string; body?: string; created_at?: string; deleted_at?: string | null; id?: string; post_id?: string; updated_at?: string }
        Relationships: [
          { foreignKeyName: "post_comments_author_id_fkey"; columns: ["author_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "post_comments_post_id_fkey"; columns: ["post_id"]; isOneToOne: false; referencedRelation: "posts"; referencedColumns: ["id"] },
        ]
      }
      post_media: {
        Row: { alt_text: string | null; created_at: string; id: string; mime_type: string; post_id: string; storage_path: string }
        Insert: { alt_text?: string | null; created_at?: string; id?: string; mime_type: string; post_id: string; storage_path: string }
        Update: { alt_text?: string | null; created_at?: string; id?: string; mime_type?: string; post_id?: string; storage_path?: string }
        Relationships: [{ foreignKeyName: "post_media_post_id_fkey"; columns: ["post_id"]; isOneToOne: true; referencedRelation: "posts"; referencedColumns: ["id"] }]
      }
      post_poll_options: {
        Row: { id: string; label: string; position: number; post_id: string }
        Insert: { id?: string; label: string; position: number; post_id: string }
        Update: { id?: string; label?: string; position?: number; post_id?: string }
        Relationships: [{ foreignKeyName: "post_poll_options_post_id_fkey"; columns: ["post_id"]; isOneToOne: false; referencedRelation: "post_polls"; referencedColumns: ["post_id"] }]
      }
      post_poll_votes: {
        Row: { created_at: string; option_id: string; post_id: string; user_id: string }
        Insert: { created_at?: string; option_id: string; post_id: string; user_id: string }
        Update: { created_at?: string; option_id?: string; post_id?: string; user_id?: string }
        Relationships: [
          { foreignKeyName: "post_poll_votes_post_id_option_id_fkey"; columns: ["post_id", "option_id"]; isOneToOne: false; referencedRelation: "post_poll_options"; referencedColumns: ["post_id", "id"] },
          { foreignKeyName: "post_poll_votes_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      post_polls: {
        Row: { created_at: string; post_id: string }
        Insert: { created_at?: string; post_id: string }
        Update: { created_at?: string; post_id?: string }
        Relationships: [{ foreignKeyName: "post_polls_post_id_fkey"; columns: ["post_id"]; isOneToOne: true; referencedRelation: "posts"; referencedColumns: ["id"] }]
      }
      post_reactions: {
        Row: { created_at: string; post_id: string; reaction_type: Database["public"]["Enums"]["post_reaction_type"]; user_id: string }
        Insert: { created_at?: string; post_id: string; reaction_type?: Database["public"]["Enums"]["post_reaction_type"]; user_id: string }
        Update: { created_at?: string; post_id?: string; reaction_type?: Database["public"]["Enums"]["post_reaction_type"]; user_id?: string }
        Relationships: [
          { foreignKeyName: "post_reactions_post_id_fkey"; columns: ["post_id"]; isOneToOne: false; referencedRelation: "posts"; referencedColumns: ["id"] },
          { foreignKeyName: "post_reactions_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      posts: {
        Row: { author_id: string; body: string; category: Database["public"]["Enums"]["post_category"]; created_at: string; deleted_at: string | null; id: string; post_type: Database["public"]["Enums"]["post_type"]; updated_at: string }
        Insert: { author_id: string; body: string; category: Database["public"]["Enums"]["post_category"]; created_at?: string; deleted_at?: string | null; id?: string; post_type?: Database["public"]["Enums"]["post_type"]; updated_at?: string }
        Update: { author_id?: string; body?: string; category?: Database["public"]["Enums"]["post_category"]; created_at?: string; deleted_at?: string | null; id?: string; post_type?: Database["public"]["Enums"]["post_type"]; updated_at?: string }
        Relationships: [{ foreignKeyName: "posts_author_id_fkey"; columns: ["author_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }]
      }
      profile_skills: {
        Row: { created_at: string; skill: string; user_id: string }
        Insert: { created_at?: string; skill: string; user_id: string }
        Update: { created_at?: string; skill?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "profile_skills_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }]
      }
      profiles: {
        Row: { account_status: Database["public"]["Enums"]["account_status"]; avatar_path: string | null; contact_visibility: Database["public"]["Enums"]["contact_visibility"]; created_at: string; full_name: string; headline: string | null; id: string; location: string | null; onboarding_completed_at: string | null; profile_type: Database["public"]["Enums"]["profile_type"] | null; slug: string | null; summary: string | null; updated_at: string }
        Insert: { account_status?: Database["public"]["Enums"]["account_status"]; avatar_path?: string | null; contact_visibility?: Database["public"]["Enums"]["contact_visibility"]; created_at?: string; full_name: string; headline?: string | null; id: string; location?: string | null; onboarding_completed_at?: string | null; profile_type?: Database["public"]["Enums"]["profile_type"] | null; slug?: string | null; summary?: string | null; updated_at?: string }
        Update: { account_status?: Database["public"]["Enums"]["account_status"]; avatar_path?: string | null; contact_visibility?: Database["public"]["Enums"]["contact_visibility"]; created_at?: string; full_name?: string; headline?: string | null; id?: string; location?: string | null; onboarding_completed_at?: string | null; profile_type?: Database["public"]["Enums"]["profile_type"] | null; slug?: string | null; summary?: string | null; updated_at?: string }
        Relationships: []
      }
      saved_posts: {
        Row: { created_at: string; post_id: string; user_id: string }
        Insert: { created_at?: string; post_id: string; user_id: string }
        Update: { created_at?: string; post_id?: string; user_id?: string }
        Relationships: [
          { foreignKeyName: "saved_posts_post_id_fkey"; columns: ["post_id"]; isOneToOne: false; referencedRelation: "posts"; referencedColumns: ["id"] },
          { foreignKeyName: "saved_posts_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      user_blocks: {
        Row: { blocked_id: string; blocker_id: string; created_at: string }
        Insert: { blocked_id: string; blocker_id: string; created_at?: string }
        Update: { blocked_id?: string; blocker_id?: string; created_at?: string }
        Relationships: [
          { foreignKeyName: "user_blocks_blocked_id_fkey"; columns: ["blocked_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "user_blocks_blocker_id_fkey"; columns: ["blocker_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      user_roles: {
        Row: { granted_at: string; granted_by: string | null; role: Database["public"]["Enums"]["app_role"]; user_id: string }
        Insert: { granted_at?: string; granted_by?: string | null; role: Database["public"]["Enums"]["app_role"]; user_id: string }
        Update: { granted_at?: string; granted_by?: string | null; role?: Database["public"]["Enums"]["app_role"]; user_id?: string }
        Relationships: [
          { foreignKeyName: "user_roles_granted_by_fkey"; columns: ["granted_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "user_roles_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      accept_connection_request: { Args: { p_connection_id: string }; Returns: boolean }
      block_profile: { Args: { p_target_id: string }; Returns: boolean }
      cancel_connection_request: { Args: { p_connection_id: string }; Returns: boolean }
      complete_onboarding: {
        Args: { p_availability?: string; p_contact_visibility: Database["public"]["Enums"]["contact_visibility"]; p_current_company?: string; p_current_vessel?: string; p_full_name: string; p_headline: string; p_location: string; p_profile_type: Database["public"]["Enums"]["profile_type"]; p_rank?: string; p_sailing_experience_years?: number; p_shore_career_preference?: boolean; p_skills: string[]; p_slug: string; p_summary: string; p_trading_areas?: string[]; p_vessel_types?: string[] }
        Returns: undefined
      }
      create_poll_post: {
        Args: { p_body: string; p_category: Database["public"]["Enums"]["post_category"]; p_options: string[] }
        Returns: string
      }
      decline_connection_request: { Args: { p_connection_id: string }; Returns: boolean }
      follow_profile: { Args: { p_target_id: string }; Returns: boolean }
      network_profile_visible: { Args: { p_target_id: string }; Returns: boolean }
      remove_connection: { Args: { p_connection_id: string }; Returns: boolean }
      send_connection_request: { Args: { p_target_id: string }; Returns: string }
      unblock_profile: { Args: { p_target_id: string }; Returns: boolean }
      unfollow_profile: { Args: { p_target_id: string }; Returns: boolean }
    }
    Enums: {
      account_status: "active" | "restricted" | "suspended" | "deletion_requested"
      app_role: "member" | "moderator" | "verifier" | "administrator"
      company_member_role: "owner" | "administrator" | "recruiter" | "member"
      connection_status: "pending" | "accepted"
      contact_visibility: "private" | "members" | "public"
      network_notification_type: "connection_request" | "connection_accepted" | "new_follower"
      post_category: "maritime_news" | "technical_discussion" | "vetting_sire_2_0" | "career_advice" | "safety_lessons" | "achievement" | "learning" | "industry_opinion"
      post_reaction_type: "like"
      post_type: "standard" | "poll"
      profile_type: "seafarer" | "maritime_professional" | "company" | "trainer" | "mentor" | "recruiter" | "service_provider"
    }
    CompositeTypes: { [_ in never]: never }
  }
}
