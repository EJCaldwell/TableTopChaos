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
          // 0036: the lapse clock. Null = writable. Written ONLY by
          // refresh_lapse_state(); no client may set either of these.
          lapse_warned_days: number | null
          name: string
          owner_id: string
          read_only_since: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_mode?: Database["public"]["Enums"]["game_mode"]
          id?: string
          lapse_warned_days?: number | null
          name: string
          owner_id: string
          read_only_since?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_mode?: Database["public"]["Enums"]["game_mode"]
          id?: string
          lapse_warned_days?: number | null
          name?: string
          owner_id?: string
          read_only_since?: string | null
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
      // playspace_maps / playspace_tokens — migrations 0048 + 0050 (Phase 9.1),
      // hand-written for the same reason as profiles' legal_* columns: the
      // generator targets the old hosted project, which is no longer where
      // migrations are applied.
      //
      // Note x/y carry no bounds here and none in the database either (0048
      // decision 1): position is in MAP PIXELS, and the server deliberately does
      // not clamp, so a token may legitimately sit outside a map that was
      // resized under it.
      playspace_maps: {
        Row: {
          background_asset_id: string | null
          campaign_id: string
          created_at: string
          grid_offset_x: number
          grid_offset_y: number
          grid_size: number
          height_px: number
          id: string
          is_active: boolean
          name: string
          players_can_place: boolean
          updated_at: string
          vision_enabled: boolean
          width_px: number
        }
        Insert: {
          background_asset_id?: string | null
          campaign_id: string
          created_at?: string
          grid_offset_x?: number
          grid_offset_y?: number
          grid_size?: number
          height_px?: number
          id?: string
          is_active?: boolean
          name?: string
          players_can_place?: boolean
          updated_at?: string
          vision_enabled?: boolean
          width_px?: number
        }
        Update: {
          background_asset_id?: string | null
          campaign_id?: string
          created_at?: string
          grid_offset_x?: number
          grid_offset_y?: number
          grid_size?: number
          height_px?: number
          id?: string
          is_active?: boolean
          name?: string
          players_can_place?: boolean
          updated_at?: string
          vision_enabled?: boolean
          width_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "playspace_maps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playspace_maps_background_asset_id_fkey"
            columns: ["background_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      playspace_tokens: {
        Row: {
          character_id: string | null
          color: string
          created_at: string
          id: string
          image_asset_id: string | null
          label: string | null
          map_id: string
          npc_id: string | null
          owner_user_id: string | null
          ring: string
          size_cells: number
          size_px: number
          updated_at: string
          x: number
          y: number
        }
        Insert: {
          character_id?: string | null
          color?: string
          created_at?: string
          id?: string
          image_asset_id?: string | null
          label?: string | null
          map_id: string
          npc_id?: string | null
          owner_user_id?: string | null
          ring?: string
          size_cells?: number
          size_px?: number
          updated_at?: string
          x?: number
          y?: number
        }
        Update: {
          character_id?: string | null
          color?: string
          created_at?: string
          id?: string
          image_asset_id?: string | null
          label?: string | null
          map_id?: string
          npc_id?: string | null
          owner_user_id?: string | null
          ring?: string
          size_cells?: number
          size_px?: number
          updated_at?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "playspace_tokens_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "playspace_maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playspace_tokens_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playspace_tokens_npc_id_fkey"
            columns: ["npc_id"]
            isOneToOne: false
            referencedRelation: "npcs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        // legal_* columns added by migration 0035 (Phase 7.2) and written here
        // by hand — the generator targets the old hosted project, which is no
        // longer where migrations are applied.
        //
        // 0039 renamed display_name → username and made it NOT NULL: it is
        // required, globally unique (case-insensitively) and never absent, which
        // is why `username: string` rather than `string | null`. It is absent
        // from Insert on purpose — rows are created solely by the
        // handle_new_user trigger, never by a client.
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          legal_accepted_at: string | null
          legal_version_accepted: string | null
          updated_at: string
          username: string
          username_is_provisional: boolean
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id: string
          legal_accepted_at?: string | null
          legal_version_accepted?: string | null
          updated_at?: string
          username: string
          username_is_provisional?: boolean
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          legal_accepted_at?: string | null
          legal_version_accepted?: string | null
          updated_at?: string
          username?: string
          // Clients may clear this when the user chooses a real name; nothing
          // else should ever set it true.
          username_is_provisional?: boolean
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
      // Migration 0030 (Phase 7.1). Hand-written rather than generated: the
      // generator targets the old hosted project, which is no longer where
      // migrations are applied — production is the self-hosted Railway stack and
      // has no public database endpoint to introspect. Keep these in sync with
      // supabase/migrations/0030_account_deletion.sql by hand.
      //
      // No Args: the RPC reads auth.uid() itself, deliberately, so it cannot be
      // pointed at another account. `Record<PropertyKey, never>` is the shape the
      // generator emits for a zero-argument function.
      account_deletion_preview: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      // NOTE: account_deletion_targets was added in 0030 and DROPPED in 0031 —
      // `revoke from public` left `authenticated` holding execute by name, so it
      // leaked other users' Storage paths. Not re-added here on purpose; the
      // Edge Function reads the tables directly with the service role.
      // Migration 0035 (Phase 7.2). Records the CALLING user's acceptance;
      // timestamp is stamped server-side so it cannot be backdated.
      record_legal_acceptance: {
        Args: { p_version: string }
        Returns: undefined
      }
      // Migration 0036 (Phase 7.2). The lapse countdown, readable by any MEMBER
      // of the campaign — the read-only freeze and the eventual deletion hit
      // players too, so this is not billing information.
      //
      // Always returns exactly one row; read_only_since is null when the
      // campaign is writable. Raises insufficient_privilege for non-members.
      // Migration 0041 (Phase 7.4.2). Who plays what, for ONE campaign, to
      // members of it. Returns owner_id + character NAME only — it does NOT
      // widen private.can_read_character, so sheets, inventory, journals and
      // lore stay owner-or-DM. Raises insufficient_privilege for non-members.
      // Migration 0051 (Phase 9.1a). True when the CALLER is a dev account.
      // Takes no argument by design — it cannot be used to probe other users,
      // and returns a boolean rather than the list.
      is_dev_account: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      campaign_character_names: {
        Args: { p_campaign_id: string }
        Returns: {
          user_id: string
          character_name: string
        }[]
      }
      campaign_lapse_status: {
        Args: { p_campaign_id: string }
        Returns: {
          read_only_since: string | null
          delete_after: string | null
          days_remaining: number | null
          deletion_enabled: boolean
        }[]
      }
      // Also from 0036, but service-role only and deliberately NOT typed here:
      // lapse_sweep_targets(), record_lapse_warning() and refresh_lapse_state().
      // The browser client can never call them, and listing them would invite
      // exactly that. The cleanup Edge Function calls them untyped.
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
