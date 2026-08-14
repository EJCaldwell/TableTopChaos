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
      abilities: {
        Row: {
          character_id: string
          created_at: string
          description: string
          id: string
          name: string
          position: number
          updated_at: string
          uses: number | null
        }
        Insert: {
          character_id: string
          created_at?: string
          description?: string
          id?: string
          name: string
          position?: number
          updated_at?: string
          uses?: number | null
        }
        Update: {
          character_id?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
          uses?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "abilities_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_members: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["campaign_role"]
          user_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["campaign_role"]
          user_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["campaign_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_members_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_subscriptions: {
        Row: {
          campaign_id: string
          cancel_at_period_end: boolean
          card_brand: string | null
          card_fingerprint: string | null
          card_last4: string | null
          created_at: string
          current_period_end: string | null
          id: string
          interval: string | null
          plan: string
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_blocked_reused_card: boolean
          trial_end: string | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          cancel_at_period_end?: boolean
          card_brand?: string | null
          card_fingerprint?: string | null
          card_last4?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          interval?: string | null
          plan?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_blocked_reused_card?: boolean
          trial_end?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          cancel_at_period_end?: boolean
          card_brand?: string | null
          card_fingerprint?: string | null
          card_last4?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          interval?: string | null
          plan?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_blocked_reused_card?: boolean
          trial_end?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_subscriptions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          game_mode: Database["public"]["Enums"]["game_mode"]
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_mode?: Database["public"]["Enums"]["game_mode"]
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_mode?: Database["public"]["Enums"]["game_mode"]
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      character_status: {
        Row: {
          character_id: string
          conditions: string[]
          created_at: string
          current_hp: number | null
          death_save_failures: number
          death_save_successes: number
          max_hp: number | null
          temp_hp: number
          updated_at: string
        }
        Insert: {
          character_id: string
          conditions?: string[]
          created_at?: string
          current_hp?: number | null
          death_save_failures?: number
          death_save_successes?: number
          max_hp?: number | null
          temp_hp?: number
          updated_at?: string
        }
        Update: {
          character_id?: string
          conditions?: string[]
          created_at?: string
          current_hp?: number | null
          death_save_failures?: number
          death_save_successes?: number
          max_hp?: number | null
          temp_hp?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_status_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          appearance: string
          backstory: string
          campaign_id: string
          created_at: string
          id: string
          name: string
          owner_id: string
          personality: string
          portrait_asset_id: string | null
          updated_at: string
        }
        Insert: {
          appearance?: string
          backstory?: string
          campaign_id: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
          personality?: string
          portrait_asset_id?: string | null
          updated_at?: string
        }
        Update: {
          appearance?: string
          backstory?: string
          campaign_id?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          personality?: string
          portrait_asset_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "characters_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_portrait_asset_id_fkey"
            columns: ["portrait_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_notes: {
        Row: {
          body: string
          campaign_id: string
          created_at: string
          id: string
          position: number
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          campaign_id: string
          created_at?: string
          id?: string
          position?: number
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          campaign_id?: string
          created_at?: string
          id?: string
          position?: number
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_notes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      encounter_images: {
        Row: {
          asset_id: string
          caption: string
          created_at: string
          encounter_id: string
          id: string
          position: number
          updated_at: string
        }
        Insert: {
          asset_id: string
          caption?: string
          created_at?: string
          encounter_id: string
          id?: string
          position?: number
          updated_at?: string
        }
        Update: {
          asset_id?: string
          caption?: string
          created_at?: string
          encounter_id?: string
          id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "encounter_images_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_images_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
        ]
      }
      encounter_npcs: {
        Row: {
          created_at: string
          encounter_id: string
          id: string
          npc_id: string
          position: number
        }
        Insert: {
          created_at?: string
          encounter_id: string
          id?: string
          npc_id: string
          position?: number
        }
        Update: {
          created_at?: string
          encounter_id?: string
          id?: string
          npc_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "encounter_npcs_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_npcs_npc_id_fkey"
            columns: ["npc_id"]
            isOneToOne: false
            referencedRelation: "npcs"
            referencedColumns: ["id"]
          },
        ]
      }
      encounters: {
        Row: {
          campaign_id: string
          created_at: string
          description: string
          hidden_notes: string
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          description?: string
          hidden_notes?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          description?: string
          hidden_notes?: string
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "encounters_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      initiative_entries: {
        Row: {
          campaign_id: string
          created_at: string
          hp: number | null
          id: string
          initiative: number | null
          max_hp: number | null
          name: string
          notes: string
          npc_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          hp?: number | null
          id?: string
          initiative?: number | null
          max_hp?: number | null
          name?: string
          notes?: string
          npc_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          hp?: number | null
          id?: string
          initiative?: number | null
          max_hp?: number | null
          name?: string
          notes?: string
          npc_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "initiative_entries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "initiative_entries_npc_id_fkey"
            columns: ["npc_id"]
            isOneToOne: false
            referencedRelation: "npcs"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          character_id: string
          created_at: string
          equipped: boolean
          id: string
          name: string
          notes: string
          position: number
          qty: number
          updated_at: string
        }
        Insert: {
          character_id: string
          created_at?: string
          equipped?: boolean
          id?: string
          name: string
          notes?: string
          position?: number
          qty?: number
          updated_at?: string
        }
        Update: {
          character_id?: string
          created_at?: string
          equipped?: boolean
          id?: string
          name?: string
          notes?: string
          position?: number
          qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          campaign_id: string
          code: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          role: Database["public"]["Enums"]["campaign_role"]
          uses: number
        }
        Insert: {
          campaign_id: string
          code?: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role?: Database["public"]["Enums"]["campaign_role"]
          uses?: number
        }
        Update: {
          campaign_id?: string
          code?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role?: Database["public"]["Enums"]["campaign_role"]
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "invite_codes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          body: string
          character_id: string
          created_at: string
          id: string
          position: number
          shared: boolean
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          character_id: string
          created_at?: string
          id?: string
          position?: number
          shared?: boolean
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          character_id?: string
          created_at?: string
          id?: string
          position?: number
          shared?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          byte_size: number
          campaign_id: string
          created_at: string
          height: number | null
          id: string
          mime: string
          moderation_status: string
          original_filename: string | null
          storage_path: string
          thumb_path: string | null
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          byte_size: number
          campaign_id: string
          created_at?: string
          height?: number | null
          id?: string
          mime: string
          moderation_status?: string
          original_filename?: string | null
          storage_path: string
          thumb_path?: string | null
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          byte_size?: number
          campaign_id?: string
          created_at?: string
          height?: number | null
          id?: string
          mime?: string
          moderation_status?: string
          original_filename?: string | null
          storage_path?: string
          thumb_path?: string | null
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      media_reports: {
        Row: {
          created_at: string
          id: string
          media_asset_id: string
          reason: string | null
          reporter_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          media_asset_id: string
          reason?: string | null
          reporter_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          media_asset_id?: string
          reason?: string | null
          reporter_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_reports_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      npc_stat_fields: {
        Row: {
          created_at: string
          id: string
          label: string
          position: number
          section_id: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          position?: number
          section_id: string
          updated_at?: string
          value?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          position?: number
          section_id?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "npc_stat_fields_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "npc_stat_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      npc_stat_sections: {
        Row: {
          created_at: string
          id: string
          npc_id: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          npc_id: string
          position?: number
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          npc_id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "npc_stat_sections_npc_id_fkey"
            columns: ["npc_id"]
            isOneToOne: false
            referencedRelation: "npcs"
            referencedColumns: ["id"]
          },
        ]
      }
      npcs: {
        Row: {
          campaign_id: string
          created_at: string
          description: string
          id: string
          name: string
          portrait_asset_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          portrait_asset_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          portrait_asset_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "npcs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "npcs_portrait_asset_id_fkey"
            columns: ["portrait_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quests: {
        Row: {
          campaign_id: string
          created_at: string
          description: string
          id: string
          plot_notes: string
          position: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          description?: string
          id?: string
          plot_notes?: string
          position?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          description?: string
          id?: string
          plot_notes?: string
          position?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quests_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_rsvps: {
        Row: {
          created_at: string
          id: string
          session_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          session_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          session_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_rsvps_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "schedule_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_sessions: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          notes: string
          position: number
          proposed_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          notes?: string
          position?: number
          proposed_at?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          notes?: string
          position?: number
          proposed_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_sessions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          attendees: string[]
          campaign_id: string
          created_at: string
          id: string
          position: number
          recap: string
          session_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          attendees?: string[]
          campaign_id: string
          created_at?: string
          id?: string
          position?: number
          recap?: string
          session_date?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          attendees?: string[]
          campaign_id?: string
          created_at?: string
          id?: string
          position?: number
          recap?: string
          session_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_items: {
        Row: {
          asset_id: string | null
          body: string
          campaign_id: string
          created_at: string
          id: string
          position: number
          shared_at: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          body?: string
          campaign_id: string
          created_at?: string
          id?: string
          position?: number
          shared_at?: string
          title?: string
          type: string
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          body?: string
          campaign_id?: string
          created_at?: string
          id?: string
          position?: number
          shared_at?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_fields: {
        Row: {
          created_at: string
          id: string
          label: string
          position: number
          section_id: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          position?: number
          section_id: string
          updated_at?: string
          value?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          position?: number
          section_id?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_fields_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sheet_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sheet_sections: {
        Row: {
          character_id: string
          created_at: string
          id: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          character_id: string
          created_at?: string
          id?: string
          position?: number
          title: string
          updated_at?: string
        }
        Update: {
          character_id?: string
          created_at?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_sections_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      spells: {
        Row: {
          character_id: string
          created_at: string
          description: string
          id: string
          level: number
          name: string
          position: number
          prepared: boolean
          updated_at: string
        }
        Insert: {
          character_id: string
          created_at?: string
          description?: string
          id?: string
          level?: number
          name: string
          position?: number
          prepared?: boolean
          updated_at?: string
        }
        Update: {
          character_id?: string
          created_at?: string
          description?: string
          id?: string
          level?: number
          name?: string
          position?: number
          prepared?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spells_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_redemptions: {
        Row: {
          campaign_id: string | null
          card_fingerprint: string
          first_used_at: string
          id: string
        }
        Insert: {
          campaign_id?: string | null
          card_fingerprint: string
          first_used_at?: string
          id?: string
        }
        Update: {
          campaign_id?: string | null
          card_fingerprint?: string
          first_used_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_redemptions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      campaign_entitlements: {
        Args: { p_campaign_id: string }
        Returns: {
          is_active: boolean
          storage_cap: number
          storage_used: number
        }[]
      }
      redeem_invite_code: { Args: { p_code: string }; Returns: string }
      report_media: {
        Args: { p_asset_id: string; p_reason?: string }
        Returns: undefined
      }
      set_media_status: {
        Args: { p_asset_id: string; p_status: string }
        Returns: undefined
      }
    }
    Enums: {
      campaign_role: "dm" | "player"
      game_mode: "notetaker" | "playspace" | "rpg"
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
      campaign_role: ["dm", "player"],
      game_mode: ["notetaker", "playspace", "rpg"],
    },
  },
} as const
