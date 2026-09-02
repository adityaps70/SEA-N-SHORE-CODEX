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
      maritime_profiles: {
        Row: { availability: string | null; current_company: string | null; current_vessel: string | null; rank: string | null; sailing_experience_years: number | null; shore_career_preference: boolean; trading_areas: string[]; updated_at: string; user_id: string; vessel_types: string[] }
        Insert: { availability?: string | null; current_company?: string | null; current_vessel?: string | null; rank?: string | null; sailing_experience_years?: number | null; shore_career_preference?: boolean; trading_areas?: string[]; updated_at?: string; user_id: string; vessel_types?: string[] }
        Update: { availability?: string | null; current_company?: string | null; current_vessel?: string | null; rank?: string | null; sailing_experience_years?: number | null; shore_career_preference?: boolean; trading_areas?: string[]; updated_at?: string; user_id?: string; vessel_types?: string[] }
        Relationships: [{ foreignKeyName: "maritime_profiles_user_id_fkey"; columns: ["user_id"]; isOneToOne: true; referencedRelation: "profiles"; referencedColumns: ["id"] }]
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
      complete_onboarding: {
        Args: { p_availability?: string; p_contact_visibility: Database["public"]["Enums"]["contact_visibility"]; p_current_company?: string; p_current_vessel?: string; p_full_name: string; p_headline: string; p_location: string; p_profile_type: Database["public"]["Enums"]["profile_type"]; p_rank?: string; p_sailing_experience_years?: number; p_shore_career_preference?: boolean; p_skills: string[]; p_slug: string; p_summary: string; p_trading_areas?: string[]; p_vessel_types?: string[] }
        Returns: undefined
      }
    }
    Enums: {
      account_status: "active" | "restricted" | "suspended" | "deletion_requested"
      app_role: "member" | "moderator" | "verifier" | "administrator"
      company_member_role: "owner" | "administrator" | "recruiter" | "member"
      contact_visibility: "private" | "members" | "public"
      profile_type: "seafarer" | "maritime_professional" | "company" | "trainer" | "mentor" | "recruiter" | "service_provider"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]
export type Tables<DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]) : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R } ? R : never : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R } ? R : never : never
export type TablesInsert<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Insert: infer I } ? I : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Insert: infer I } ? I : never : never
export type TablesUpdate<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Update: infer U } ? U : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Update: infer U } ? U : never : never
export type Enums<DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals }, EnumName extends DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"] : never = never> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName] : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions] : never
export type CompositeTypes<PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals }, CompositeTypeName extends PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"] : never = never> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName] : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions] : never

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "restricted", "suspended", "deletion_requested"],
      app_role: ["member", "moderator", "verifier", "administrator"],
      company_member_role: ["owner", "administrator", "recruiter", "member"],
      contact_visibility: ["private", "members", "public"],
      profile_type: ["seafarer", "maritime_professional", "company", "trainer", "mentor", "recruiter", "service_provider"],
    },
  },
} as const
