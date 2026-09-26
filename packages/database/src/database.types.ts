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
      ai_task_usage: {
        Row: {
          brand_id: string
          created_at: string
          draft_id: string | null
          estimated_cost_usd: number | null
          id: string
          input_tokens: number | null
          job_id: string | null
          model: string
          operation_id: string | null
          organization_id: string
          output_tokens: number | null
          provider: string
          task: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          draft_id?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          job_id?: string | null
          model: string
          operation_id?: string | null
          organization_id: string
          output_tokens?: number | null
          provider: string
          task: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          draft_id?: string | null
          estimated_cost_usd?: number | null
          id?: string
          input_tokens?: number | null
          job_id?: string | null
          model?: string
          operation_id?: string | null
          organization_id?: string
          output_tokens?: number | null
          provider?: string
          task?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_task_usage_brand_scope"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "ai_task_usage_draft_id_brand_id_organization_id_fkey"
            columns: ["draft_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
          {
            foreignKeyName: "ai_task_usage_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "draft_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_cache: {
        Row: {
          generated_at: string
          organization_id: string
          report: Json
          stale: boolean
        }
        Insert: {
          generated_at?: string
          organization_id: string
          report: Json
          stale?: boolean
        }
        Update: {
          generated_at?: string
          organization_id?: string
          report?: Json
          stale?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "analytics_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          organization_id: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_checkout_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          organization_id: string
          plan_key: Database["public"]["Enums"]["plan_key"]
          provider: string
          provider_customer_id: string | null
          provider_session_id: string | null
          requested_by: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          plan_key: Database["public"]["Enums"]["plan_key"]
          provider: string
          provider_customer_id?: string | null
          provider_session_id?: string | null
          requested_by: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          plan_key?: Database["public"]["Enums"]["plan_key"]
          provider?: string
          provider_customer_id?: string | null
          provider_session_id?: string | null
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_checkout_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_checkout_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          outcome: string
          payload_hash: string
          provider: string
          provider_created_at: string
          provider_event_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          outcome: string
          payload_hash: string
          provider: string
          provider_created_at: string
          provider_event_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          outcome?: string
          payload_hash?: string
          provider?: string
          provider_created_at?: string
          provider_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_competitors: {
        Row: {
          aliases: Json
          brand_id: string
          created_at: string
          domain: string
          id: string
          name: string
          notes: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          aliases?: Json
          brand_id: string
          created_at?: string
          domain: string
          id?: string
          name: string
          notes?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          aliases?: Json
          brand_id?: string
          created_at?: string
          domain?: string
          id?: string
          name?: string
          notes?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_competitors_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      brand_keywords: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          is_exclusion: boolean
          kind: string
          organization_id: string
          source: string
          status: string
          value: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          is_exclusion?: boolean
          kind?: string
          organization_id: string
          source?: string
          status?: string
          value: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          is_exclusion?: boolean
          kind?: string
          organization_id?: string
          source?: string
          status?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_keywords_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      brand_personas: {
        Row: {
          allowed_first_person_statements: Json
          brand_id: string
          created_at: string
          custom_tone: string
          default_disclosure: string
          id: string
          is_default: boolean
          name: string
          organization_id: string
          prohibited_statements: Json
          real_role: string
          reply_length: string
          technical_depth: string
          tone: string
          updated_at: string
        }
        Insert: {
          allowed_first_person_statements?: Json
          brand_id: string
          created_at?: string
          custom_tone?: string
          default_disclosure: string
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          prohibited_statements?: Json
          real_role: string
          reply_length: string
          technical_depth?: string
          tone: string
          updated_at?: string
        }
        Update: {
          allowed_first_person_statements?: Json
          brand_id?: string
          created_at?: string
          custom_tone?: string
          default_disclosure?: string
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          prohibited_statements?: Json
          real_role?: string
          reply_length?: string
          technical_depth?: string
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_personas_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      brand_subreddits: {
        Row: {
          allowed_reply_style: string
          brand_id: string
          created_at: string
          id: string
          internal_interpretation: string
          internal_notes: string
          minimum_score: number
          monitor_hot: boolean
          monitor_new: boolean
          monitor_rising: boolean
          organization_id: string
          priority: number
          product_relevance: number
          risk_level: string
          status: string
          subreddit_id: string
          updated_at: string
        }
        Insert: {
          allowed_reply_style?: string
          brand_id: string
          created_at?: string
          id?: string
          internal_interpretation?: string
          internal_notes?: string
          minimum_score?: number
          monitor_hot?: boolean
          monitor_new?: boolean
          monitor_rising?: boolean
          organization_id: string
          priority?: number
          product_relevance?: number
          risk_level?: string
          status?: string
          subreddit_id: string
          updated_at?: string
        }
        Update: {
          allowed_reply_style?: string
          brand_id?: string
          created_at?: string
          id?: string
          internal_interpretation?: string
          internal_notes?: string
          minimum_score?: number
          monitor_hot?: boolean
          monitor_new?: boolean
          monitor_rising?: boolean
          organization_id?: string
          priority?: number
          product_relevance?: number
          risk_level?: string
          status?: string
          subreddit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_subreddits_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "brand_subreddits_subreddit_id_fkey"
            columns: ["subreddit_id"]
            isOneToOne: false
            referencedRelation: "subreddits"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          profile: Json
          status: string
          updated_at: string
          website_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          profile: Json
          status?: string
          updated_at?: string
          website_url: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          profile?: Json
          status?: string
          updated_at?: string
          website_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_api_keys: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          revoked_at: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          revoked_at?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversion_api_keys_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "conversion_api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_events: {
        Row: {
          brand_id: string
          created_at: string
          currency: string
          event_type: string
          external_id: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          occurred_at: string
          organization_id: string
          payload_hash: string
          source: string
          tracking_click_id: string
          tracking_link_id: string
          value: number
        }
        Insert: {
          brand_id: string
          created_at?: string
          currency: string
          event_type: string
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          occurred_at: string
          organization_id: string
          payload_hash: string
          source: string
          tracking_click_id: string
          tracking_link_id: string
          value: number
        }
        Update: {
          brand_id?: string
          created_at?: string
          currency?: string
          event_type?: string
          external_id?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          payload_hash?: string
          source?: string
          tracking_click_id?: string
          tracking_link_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversion_events_tracking_click_id_tracking_link_id_brand_fkey"
            columns: [
              "tracking_click_id",
              "tracking_link_id",
              "brand_id",
              "organization_id",
            ]
            isOneToOne: false
            referencedRelation: "tracking_clicks"
            referencedColumns: [
              "id",
              "tracking_link_id",
              "brand_id",
              "organization_id",
            ]
          },
        ]
      }
      draft_claims: {
        Row: {
          claim_text: string
          confidence: string
          created_at: string
          draft_id: string
          draft_version_id: string
          evidence_kind: string
          explanation: string
          id: string
          organization_id: string
          provenance: Json
          source_chunk_ids: string[]
          status: string
        }
        Insert: {
          claim_text: string
          confidence: string
          created_at?: string
          draft_id: string
          draft_version_id: string
          evidence_kind?: string
          explanation: string
          id?: string
          organization_id: string
          provenance?: Json
          source_chunk_ids?: string[]
          status: string
        }
        Update: {
          claim_text?: string
          confidence?: string
          created_at?: string
          draft_id?: string
          draft_version_id?: string
          evidence_kind?: string
          explanation?: string
          id?: string
          organization_id?: string
          provenance?: Json
          source_chunk_ids?: string[]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_claims_draft_version_id_draft_id_organization_id_fkey"
            columns: ["draft_version_id", "draft_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "draft_versions"
            referencedColumns: ["id", "draft_id", "organization_id"]
          },
        ]
      }
      draft_compliance_checks: {
        Row: {
          checks: Json
          context_checksum: string
          created_at: string
          draft_id: string
          draft_version_id: string
          id: string
          model_metadata: Json
          organization_id: string
          safe_to_approve: boolean
          status: string
        }
        Insert: {
          checks: Json
          context_checksum: string
          created_at?: string
          draft_id: string
          draft_version_id: string
          id?: string
          model_metadata?: Json
          organization_id: string
          safe_to_approve: boolean
          status: string
        }
        Update: {
          checks?: Json
          context_checksum?: string
          created_at?: string
          draft_id?: string
          draft_version_id?: string
          id?: string
          model_metadata?: Json
          organization_id?: string
          safe_to_approve?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_compliance_checks_draft_version_id_draft_id_organiza_fkey"
            columns: ["draft_version_id", "draft_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "draft_versions"
            referencedColumns: ["id", "draft_id", "organization_id"]
          },
        ]
      }
      draft_feedback: {
        Row: {
          brand_id: string
          created_at: string
          draft_id: string
          id: string
          notes: string
          opportunity_id: string
          organization_id: string
          rating: string
          user_id: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          draft_id: string
          id?: string
          notes?: string
          opportunity_id: string
          organization_id: string
          rating: string
          user_id?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          draft_id?: string
          id?: string
          notes?: string
          opportunity_id?: string
          organization_id?: string
          rating?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_feedback_draft_id_brand_id_organization_id_fkey"
            columns: ["draft_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
          {
            foreignKeyName: "draft_feedback_opportunity_id_brand_id_organization_id_fkey"
            columns: ["opportunity_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
          {
            foreignKeyName: "draft_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_jobs: {
        Row: {
          attempts: number
          available_at: string
          brand_id: string
          created_at: string
          draft_id: string
          error_code: string | null
          id: string
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          options: Json
          organization_id: string
          request_fingerprint: string | null
          request_key: string | null
          requested_by: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          attempts?: number
          available_at?: string
          brand_id: string
          created_at?: string
          draft_id: string
          error_code?: string | null
          id?: string
          kind: string
          lease_expires_at?: string | null
          lease_token?: string | null
          options?: Json
          organization_id: string
          request_fingerprint?: string | null
          request_key?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          attempts?: number
          available_at?: string
          brand_id?: string
          created_at?: string
          draft_id?: string
          error_code?: string | null
          id?: string
          kind?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          options?: Json
          organization_id?: string
          request_fingerprint?: string | null
          request_key?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_jobs_draft_id_brand_id_organization_id_fkey"
            columns: ["draft_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
          {
            foreignKeyName: "draft_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_versions: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          draft_id: string
          id: string
          instruction: string
          organization_id: string
          source: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          draft_id: string
          id?: string
          instruction?: string
          organization_id: string
          source: string
          version: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          draft_id?: string
          id?: string
          instruction?: string
          organization_id?: string
          source?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_versions_draft_id_organization_id_fkey"
            columns: ["draft_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      drafts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string
          brand_mentioned: boolean
          compliance_status: string
          context_checksum: string | null
          created_at: string
          created_by: string | null
          current_content: string
          current_version: number
          disclosure_included: boolean
          error_code: string | null
          generation_metadata: Json
          id: string
          inserted_at: string | null
          inserted_version: number | null
          opportunity_id: string
          organization_id: string
          persona_id: string
          published_at: string | null
          published_comment_url: string | null
          published_version: number | null
          purged_at: string | null
          rejection_reason: string | null
          status: string
          strategy: string
          suggested_link: string | null
          updated_at: string
          verification_status: string
          verified_version: number | null
          warnings_acknowledged_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id: string
          brand_mentioned?: boolean
          compliance_status?: string
          context_checksum?: string | null
          created_at?: string
          created_by?: string | null
          current_content?: string
          current_version?: number
          disclosure_included?: boolean
          error_code?: string | null
          generation_metadata?: Json
          id?: string
          inserted_at?: string | null
          inserted_version?: number | null
          opportunity_id: string
          organization_id: string
          persona_id: string
          published_at?: string | null
          published_comment_url?: string | null
          published_version?: number | null
          purged_at?: string | null
          rejection_reason?: string | null
          status?: string
          strategy?: string
          suggested_link?: string | null
          updated_at?: string
          verification_status?: string
          verified_version?: number | null
          warnings_acknowledged_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string
          brand_mentioned?: boolean
          compliance_status?: string
          context_checksum?: string | null
          created_at?: string
          created_by?: string | null
          current_content?: string
          current_version?: number
          disclosure_included?: boolean
          error_code?: string | null
          generation_metadata?: Json
          id?: string
          inserted_at?: string | null
          inserted_version?: number | null
          opportunity_id?: string
          organization_id?: string
          persona_id?: string
          published_at?: string | null
          published_comment_url?: string | null
          published_version?: number | null
          purged_at?: string | null
          rejection_reason?: string | null
          status?: string
          strategy?: string
          suggested_link?: string | null
          updated_at?: string
          verification_status?: string
          verified_version?: number | null
          warnings_acknowledged_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drafts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_opportunity_id_brand_id_organization_id_fkey"
            columns: ["opportunity_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
          {
            foreignKeyName: "drafts_persona_id_brand_id_organization_id_fkey"
            columns: ["persona_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brand_personas"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
        ]
      }
      extension_connection_codes: {
        Row: {
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          name: string
          organization_id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          name: string
          organization_id: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          name?: string
          organization_id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_connection_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extension_connection_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      extension_sessions: {
        Row: {
          created_at: string
          expires_at: string
          extension_origin: string
          id: string
          last_used_at: string | null
          name: string
          organization_id: string
          rate_window_count: number
          rate_window_started_at: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          extension_origin: string
          id?: string
          last_used_at?: string | null
          name: string
          organization_id: string
          rate_window_count?: number
          rate_window_started_at?: string
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          extension_origin?: string
          id?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          rate_window_count?: number
          rate_window_started_at?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extension_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          brand_id: string
          checksum: string
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string
          embedding_identity: string
          id: string
          organization_id: string
          section_heading: string | null
          source_id: string
          token_count: number
        }
        Insert: {
          brand_id: string
          checksum: string
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding: string
          embedding_identity?: string
          id?: string
          organization_id: string
          section_heading?: string | null
          source_id: string
          token_count: number
        }
        Update: {
          brand_id?: string
          checksum?: string
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string
          embedding_identity?: string
          id?: string
          organization_id?: string
          section_heading?: string | null
          source_id?: string
          token_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_source_id_brand_id_organizati_fkey"
            columns: ["document_id", "source_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: [
              "id",
              "source_id",
              "brand_id",
              "organization_id",
            ]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          brand_id: string
          canonical_url: string | null
          checksum: string
          content: string
          created_at: string
          document_key: string
          embedding_identity: string
          id: string
          is_included: boolean
          organization_id: string
          page_number: number | null
          section_heading: string | null
          source_id: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          canonical_url?: string | null
          checksum: string
          content: string
          created_at?: string
          document_key: string
          embedding_identity?: string
          id?: string
          is_included?: boolean
          organization_id: string
          page_number?: number | null
          section_heading?: string | null
          source_id: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          canonical_url?: string | null
          checksum?: string
          content?: string
          created_at?: string
          document_key?: string
          embedding_identity?: string
          id?: string
          is_included?: boolean
          organization_id?: string
          page_number?: number | null
          section_heading?: string | null
          source_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_source_id_brand_id_organization_id_fkey"
            columns: ["source_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
        ]
      }
      knowledge_jobs: {
        Row: {
          attempts: number
          available_at: string
          brand_id: string
          created_at: string
          error_code: string | null
          generation: number
          id: string
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          organization_id: string
          source_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          brand_id: string
          created_at?: string
          error_code?: string | null
          generation: number
          id?: string
          kind: string
          lease_expires_at?: string | null
          lease_token?: string | null
          organization_id: string
          source_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          brand_id?: string
          created_at?: string
          error_code?: string | null
          generation?: number
          id?: string
          kind?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          organization_id?: string
          source_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_jobs_source_id_brand_id_organization_id_fkey"
            columns: ["source_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          brand_id: string
          chunk_count: number
          created_at: string
          deleted_at: string | null
          error_code: string | null
          filename: string | null
          generation: number
          id: string
          last_ingested_at: string | null
          manual_text: string | null
          mime_type: string | null
          name: string
          organization_id: string
          page_count: number
          selected_pages: string[]
          source_url: string | null
          status: string
          storage_path: string | null
          type: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          chunk_count?: number
          created_at?: string
          deleted_at?: string | null
          error_code?: string | null
          filename?: string | null
          generation?: number
          id?: string
          last_ingested_at?: string | null
          manual_text?: string | null
          mime_type?: string | null
          name: string
          organization_id: string
          page_count?: number
          selected_pages?: string[]
          source_url?: string | null
          status?: string
          storage_path?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          chunk_count?: number
          created_at?: string
          deleted_at?: string | null
          error_code?: string | null
          filename?: string | null
          generation?: number
          id?: string
          last_ingested_at?: string | null
          manual_text?: string | null
          mime_type?: string | null
          name?: string
          organization_id?: string
          page_count?: number
          selected_pages?: string[]
          source_url?: string | null
          status?: string
          storage_path?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          dedupe_key: string
          delivery_fingerprint: string | null
          error_code: string | null
          first_attempt_at: string | null
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          organization_id: string
          payload: Json
          provider: string | null
          provider_message_id: string | null
          sent_at: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          dedupe_key: string
          delivery_fingerprint?: string | null
          error_code?: string | null
          first_attempt_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          organization_id: string
          payload?: Json
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          dedupe_key?: string
          delivery_fingerprint?: string | null
          error_code?: string | null
          first_attempt_at?: string | null
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          organization_id?: string
          payload?: Json
          provider?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: false
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          categories: Json
          created_at: string
          digest_time: string
          id: string
          minimum_score: number
          organization_id: string
          quiet_end: string | null
          quiet_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          categories?: Json
          created_at?: string
          digest_time?: string
          id?: string
          minimum_score?: number
          organization_id: string
          quiet_end?: string | null
          quiet_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          categories?: Json
          created_at?: string
          digest_time?: string
          id?: string
          minimum_score?: number
          organization_id?: string
          quiet_end?: string | null
          quiet_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_organization_id_user_id_fkey"
            columns: ["organization_id", "user_id"]
            isOneToOne: true
            referencedRelation: "organization_members"
            referencedColumns: ["organization_id", "user_id"]
          },
        ]
      }
      opportunities: {
        Row: {
          brand_id: string
          buying_intent: number
          competitor_context: number
          created_at: string
          dismissed_reason: string | null
          engagement_velocity: number
          evaluated_at: string
          final_score: number
          freshness: number
          id: string
          input_checksum: string
          intent_category: string
          is_blocked: boolean
          knowledge_citations: Json
          matched_capabilities: Json
          matched_competitor_ids: Json
          missing_capabilities: Json
          model_metadata: Json
          organization_id: string
          penalty_score: number
          reasoning_summary: string
          reddit_post_id: string
          risk_level: string
          risk_reasons: Json
          rule_fit: number
          semantic_relevance: number
          status: string
          subreddit_id: string
          suggested_action: string
          summary: string
          updated_at: string
          user_need: string
        }
        Insert: {
          brand_id: string
          buying_intent: number
          competitor_context: number
          created_at?: string
          dismissed_reason?: string | null
          engagement_velocity: number
          evaluated_at?: string
          final_score: number
          freshness: number
          id?: string
          input_checksum: string
          intent_category: string
          is_blocked?: boolean
          knowledge_citations?: Json
          matched_capabilities?: Json
          matched_competitor_ids?: Json
          missing_capabilities?: Json
          model_metadata?: Json
          organization_id: string
          penalty_score: number
          reasoning_summary: string
          reddit_post_id: string
          risk_level: string
          risk_reasons?: Json
          rule_fit: number
          semantic_relevance: number
          status?: string
          subreddit_id: string
          suggested_action: string
          summary: string
          updated_at?: string
          user_need: string
        }
        Update: {
          brand_id?: string
          buying_intent?: number
          competitor_context?: number
          created_at?: string
          dismissed_reason?: string | null
          engagement_velocity?: number
          evaluated_at?: string
          final_score?: number
          freshness?: number
          id?: string
          input_checksum?: string
          intent_category?: string
          is_blocked?: boolean
          knowledge_citations?: Json
          matched_capabilities?: Json
          matched_competitor_ids?: Json
          missing_capabilities?: Json
          model_metadata?: Json
          organization_id?: string
          penalty_score?: number
          reasoning_summary?: string
          reddit_post_id?: string
          risk_level?: string
          risk_reasons?: Json
          rule_fit?: number
          semantic_relevance?: number
          status?: string
          subreddit_id?: string
          suggested_action?: string
          summary?: string
          updated_at?: string
          user_need?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "opportunities_reddit_post_id_subreddit_id_fkey"
            columns: ["reddit_post_id", "subreddit_id"]
            isOneToOne: false
            referencedRelation: "reddit_posts"
            referencedColumns: ["id", "subreddit_id"]
          },
          {
            foreignKeyName: "opportunities_subreddit_id_fkey"
            columns: ["subreddit_id"]
            isOneToOne: false
            referencedRelation: "subreddits"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_data_requests: {
        Row: {
          artifact_bytes: number | null
          artifact_path: string | null
          artifact_sha256: string | null
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          error_code: string | null
          expires_at: string | null
          id: string
          kind: string
          organization_id: string
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          artifact_bytes?: number | null
          artifact_path?: string | null
          artifact_sha256?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          error_code?: string | null
          expires_at?: string | null
          id?: string
          kind: string
          organization_id: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          artifact_bytes?: number | null
          artifact_path?: string | null
          artifact_sha256?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          error_code?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          organization_id?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_data_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_data_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["organization_role"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          organization_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["organization_role"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["organization_role"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          invited_by: string | null
          joined_at: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          user_id: string
        }
        Insert: {
          invited_by?: string | null
          joined_at?: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          user_id: string
        }
        Update: {
          invited_by?: string | null
          joined_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_email: string
          created_at: string
          default_currency: string
          deleted_at: string | null
          id: string
          name: string
          slug: string
          status: string
          timezone: string
          trial_ends_at: string
          trial_started_at: string
          updated_at: string
        }
        Insert: {
          billing_email: string
          created_at?: string
          default_currency?: string
          deleted_at?: string | null
          id?: string
          name: string
          slug: string
          status?: string
          timezone?: string
          trial_ends_at?: string
          trial_started_at?: string
          updated_at?: string
        }
        Update: {
          billing_email?: string
          created_at?: string
          default_currency?: string
          deleted_at?: string | null
          id?: string
          name?: string
          slug?: string
          status?: string
          timezone?: string
          trial_ends_at?: string
          trial_started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      plan_catalog: {
        Row: {
          ai_draft_limit: number
          brand_limit: number
          features: Json
          key: Database["public"]["Enums"]["plan_key"]
          member_limit: number
          monthly_price_usd: number
          name: string
          opportunity_limit: number
          opportunity_period: string
          organization_limit: number
          subreddit_limit: number
          trial_days: number | null
        }
        Insert: {
          ai_draft_limit: number
          brand_limit: number
          features: Json
          key: Database["public"]["Enums"]["plan_key"]
          member_limit: number
          monthly_price_usd: number
          name: string
          opportunity_limit: number
          opportunity_period: string
          organization_limit: number
          subreddit_limit: number
          trial_days?: number | null
        }
        Update: {
          ai_draft_limit?: number
          brand_limit?: number
          features?: Json
          key?: Database["public"]["Enums"]["plan_key"]
          member_limit?: number
          monthly_price_usd?: number
          name?: string
          opportunity_limit?: number
          opportunity_period?: string
          organization_limit?: number
          subreddit_limit?: number
          trial_days?: number | null
        }
        Relationships: []
      }
      privacy_jobs: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          error_code: string | null
          id: string
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          organization_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          error_code?: string | null
          id: string
          kind: string
          lease_expires_at?: string | null
          lease_token?: string | null
          organization_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          error_code?: string | null
          id?: string
          kind?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_jobs_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "organization_data_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "privacy_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          is_platform_admin: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id: string
          is_platform_admin?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_platform_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      reddit_jobs: {
        Row: {
          attempts: number
          available_at: string
          brand_id: string | null
          created_at: string
          dedupe_key: string
          error_code: string | null
          id: string
          kind: string
          lease_expires_at: string | null
          lease_token: string | null
          opportunity_id: string | null
          organization_id: string | null
          reddit_post_id: string | null
          sort: string
          status: string
          subreddit_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          brand_id?: string | null
          created_at?: string
          dedupe_key: string
          error_code?: string | null
          id?: string
          kind: string
          lease_expires_at?: string | null
          lease_token?: string | null
          opportunity_id?: string | null
          organization_id?: string | null
          reddit_post_id?: string | null
          sort?: string
          status?: string
          subreddit_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          brand_id?: string | null
          created_at?: string
          dedupe_key?: string
          error_code?: string | null
          id?: string
          kind?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          opportunity_id?: string | null
          organization_id?: string | null
          reddit_post_id?: string | null
          sort?: string
          status?: string
          subreddit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reddit_jobs_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "reddit_jobs_opportunity_id_brand_id_organization_id_reddit_fkey"
            columns: [
              "opportunity_id",
              "brand_id",
              "organization_id",
              "reddit_post_id",
            ]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: [
              "id",
              "brand_id",
              "organization_id",
              "reddit_post_id",
            ]
          },
          {
            foreignKeyName: "reddit_jobs_reddit_post_id_fkey"
            columns: ["reddit_post_id"]
            isOneToOne: false
            referencedRelation: "reddit_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reddit_jobs_subreddit_id_fkey"
            columns: ["subreddit_id"]
            isOneToOne: false
            referencedRelation: "subreddits"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_posts: {
        Row: {
          author_name: string | null
          body: string | null
          body_excerpt: string | null
          created_at: string
          created_at_provider: string
          flair: string | null
          id: string
          is_archived: boolean
          is_deleted: boolean
          is_edited: boolean
          is_locked: boolean
          is_nsfw: boolean
          last_synced_at: string
          num_comments: number
          permalink: string | null
          provider: string
          provider_post_id: string
          purged_at: string | null
          raw_metadata: Json
          score: number
          subreddit_id: string
          title: string | null
          updated_at: string
          upvote_ratio: number | null
        }
        Insert: {
          author_name?: string | null
          body?: string | null
          body_excerpt?: string | null
          created_at?: string
          created_at_provider: string
          flair?: string | null
          id?: string
          is_archived?: boolean
          is_deleted?: boolean
          is_edited?: boolean
          is_locked?: boolean
          is_nsfw?: boolean
          last_synced_at?: string
          num_comments?: number
          permalink?: string | null
          provider: string
          provider_post_id: string
          purged_at?: string | null
          raw_metadata?: Json
          score?: number
          subreddit_id: string
          title?: string | null
          updated_at?: string
          upvote_ratio?: number | null
        }
        Update: {
          author_name?: string | null
          body?: string | null
          body_excerpt?: string | null
          created_at?: string
          created_at_provider?: string
          flair?: string | null
          id?: string
          is_archived?: boolean
          is_deleted?: boolean
          is_edited?: boolean
          is_locked?: boolean
          is_nsfw?: boolean
          last_synced_at?: string
          num_comments?: number
          permalink?: string | null
          provider?: string
          provider_post_id?: string
          purged_at?: string | null
          raw_metadata?: Json
          score?: number
          subreddit_id?: string
          title?: string | null
          updated_at?: string
          upvote_ratio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reddit_posts_subreddit_id_fkey"
            columns: ["subreddit_id"]
            isOneToOne: false
            referencedRelation: "subreddits"
            referencedColumns: ["id"]
          },
        ]
      }
      reddit_sync_checkpoints: {
        Row: {
          consecutive_errors: number
          cursor: string | null
          error_code: string | null
          id: string
          last_error_at: string | null
          last_post_refresh_at: string | null
          last_rules_sync_at: string | null
          last_success_at: string | null
          next_sync_at: string
          provider_paused: boolean
          provider_retry_at: string | null
          sort: string
          subreddit_id: string
        }
        Insert: {
          consecutive_errors?: number
          cursor?: string | null
          error_code?: string | null
          id?: string
          last_error_at?: string | null
          last_post_refresh_at?: string | null
          last_rules_sync_at?: string | null
          last_success_at?: string | null
          next_sync_at?: string
          provider_paused?: boolean
          provider_retry_at?: string | null
          sort: string
          subreddit_id: string
        }
        Update: {
          consecutive_errors?: number
          cursor?: string | null
          error_code?: string | null
          id?: string
          last_error_at?: string | null
          last_post_refresh_at?: string | null
          last_rules_sync_at?: string | null
          last_success_at?: string | null
          next_sync_at?: string
          provider_paused?: boolean
          provider_retry_at?: string | null
          sort?: string
          subreddit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reddit_sync_checkpoints_subreddit_id_fkey"
            columns: ["subreddit_id"]
            isOneToOne: false
            referencedRelation: "subreddits"
            referencedColumns: ["id"]
          },
        ]
      }
      responsible_use_acceptances: {
        Row: {
          accepted_at: string
          notice_version: string
          organization_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          notice_version?: string
          organization_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          notice_version?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "responsible_use_acceptances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responsible_use_acceptances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subreddit_rules: {
        Row: {
          applies_to: string
          description: string
          id: string
          kind: string
          last_synced_at: string
          provider_rule_id: string
          raw_data: Json
          subreddit_id: string
          title: string
        }
        Insert: {
          applies_to?: string
          description: string
          id?: string
          kind?: string
          last_synced_at?: string
          provider_rule_id: string
          raw_data?: Json
          subreddit_id: string
          title: string
        }
        Update: {
          applies_to?: string
          description?: string
          id?: string
          kind?: string
          last_synced_at?: string
          provider_rule_id?: string
          raw_data?: Json
          subreddit_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "subreddit_rules_subreddit_id_fkey"
            columns: ["subreddit_id"]
            isOneToOne: false
            referencedRelation: "subreddits"
            referencedColumns: ["id"]
          },
        ]
      }
      subreddits: {
        Row: {
          created_at: string
          description: string
          display_name: string
          id: string
          is_nsfw: boolean
          last_synced_at: string | null
          metadata: Json
          name: string
          provider: string
          provider_id: string | null
          subscriber_count: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          display_name: string
          id?: string
          is_nsfw?: boolean
          last_synced_at?: string | null
          metadata?: Json
          name: string
          provider?: string
          provider_id?: string | null
          subscriber_count?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          display_name?: string
          id?: string
          is_nsfw?: boolean
          last_synced_at?: string | null
          metadata?: Json
          name?: string
          provider?: string
          provider_id?: string | null
          subscriber_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          current_period_start: string
          grace_ends_at: string | null
          id: string
          latest_provider_event_at: string | null
          latest_provider_event_id: string | null
          organization_id: string
          plan_key: Database["public"]["Enums"]["plan_key"]
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end: string
          current_period_start: string
          grace_ends_at?: string | null
          id?: string
          latest_provider_event_at?: string | null
          latest_provider_event_id?: string | null
          organization_id: string
          plan_key: Database["public"]["Enums"]["plan_key"]
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          grace_ends_at?: string | null
          id?: string
          latest_provider_event_at?: string | null
          latest_provider_event_id?: string | null
          organization_id?: string
          plan_key?: Database["public"]["Enums"]["plan_key"]
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plan_catalog"
            referencedColumns: ["key"]
          },
        ]
      }
      tracking_clicks: {
        Row: {
          anonymous_visitor_id: string | null
          brand_id: string
          id: string
          occurred_at: string
          organization_id: string
          receipt_hash: string
          tracking_link_id: string
        }
        Insert: {
          anonymous_visitor_id?: string | null
          brand_id: string
          id: string
          occurred_at?: string
          organization_id: string
          receipt_hash: string
          tracking_link_id: string
        }
        Update: {
          anonymous_visitor_id?: string | null
          brand_id?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          receipt_hash?: string
          tracking_link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_clicks_tracking_link_id_brand_id_organization_id_fkey"
            columns: ["tracking_link_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tracking_links"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
        ]
      }
      tracking_links: {
        Row: {
          brand_id: string
          code: string
          created_at: string
          created_by: string | null
          destination_url: string
          draft_id: string
          draft_style: string
          draft_version: number
          id: string
          opportunity_id: string
          organization_id: string
          overwrite_utm: boolean
          revoked_at: string | null
          status: string
          utm_config: Json
        }
        Insert: {
          brand_id: string
          code: string
          created_at?: string
          created_by?: string | null
          destination_url: string
          draft_id: string
          draft_style: string
          draft_version: number
          id?: string
          opportunity_id: string
          organization_id: string
          overwrite_utm?: boolean
          revoked_at?: string | null
          status?: string
          utm_config?: Json
        }
        Update: {
          brand_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          destination_url?: string
          draft_id?: string
          draft_style?: string
          draft_version?: number
          id?: string
          opportunity_id?: string
          organization_id?: string
          overwrite_utm?: boolean
          revoked_at?: string | null
          status?: string
          utm_config?: Json
        }
        Relationships: [
          {
            foreignKeyName: "tracking_links_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tracking_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_links_draft_id_brand_id_organization_id_fkey"
            columns: ["draft_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
          {
            foreignKeyName: "tracking_links_opportunity_id_brand_id_organization_id_fkey"
            columns: ["opportunity_id", "brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id", "brand_id", "organization_id"]
          },
        ]
      }
      tracking_settings: {
        Row: {
          attribution_days: number
          consent_text: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          attribution_days?: number
          consent_text?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          attribution_days?: number
          consent_text?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          id: string
          metric: string
          organization_id: string
          period_end: string
          period_start: string
          quantity: number
          updated_at: string
        }
        Insert: {
          id?: string
          metric: string
          organization_id: string
          period_end: string
          period_start: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          id?: string
          metric?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_token_hash: string }; Returns: string }
      add_brand_subreddit: {
        Args: { p_brand_id: string; p_name: string; p_settings: Json }
        Returns: string
      }
      add_knowledge_source: {
        Args: { p_brand_id: string; p_id: string; p_input: Json }
        Returns: string
      }
      approve_draft: {
        Args: {
          p_accept_responsible_use: boolean
          p_acknowledge_warnings: boolean
          p_draft_id: string
          p_expected_version: number
        }
        Returns: undefined
      }
      archive_brand: {
        Args: { p_archived: boolean; p_brand_id: string }
        Returns: undefined
      }
      begin_billing_checkout: {
        Args: {
          p_idempotency_key: string
          p_organization_id: string
          p_plan_key: string
          p_provider?: string
        }
        Returns: Json
      }
      begin_organization_export: {
        Args: { p_organization_id: string }
        Returns: string
      }
      bulk_dismiss_opportunities: {
        Args: { p_ids: string[]; p_reason: string }
        Returns: number
      }
      change_member_role: {
        Args: {
          p_organization_id: string
          p_role: Database["public"]["Enums"]["organization_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      complete_mock_checkout: {
        Args: { p_organization_id: string; p_request_id: string }
        Returns: Json
      }
      confirm_organization_deletion: {
        Args: { p_confirmation: string; p_organization_id: string }
        Returns: string
      }
      create_conversion_api_key: {
        Args: {
          p_brand_id: string
          p_hash: string
          p_name: string
          p_organization_id: string
          p_prefix: string
          p_replaces?: string
        }
        Returns: Json
      }
      create_extension_connection_code: {
        Args: { p_code_hash: string; p_name: string; p_organization_id: string }
        Returns: Json
      }
      create_organization: {
        Args: {
          p_billing_email: string
          p_default_currency?: string
          p_name: string
          p_slug: string
          p_timezone?: string
        }
        Returns: string
      }
      create_tracking_link: {
        Args: {
          p_code: string
          p_destination: string
          p_draft_id: string
          p_expected_version: number
          p_organization_id: string
          p_overwrite: boolean
          p_utm: Json
        }
        Returns: Json
      }
      delete_brand_keyword: { Args: { p_id: string }; Returns: undefined }
      delete_knowledge_source: {
        Args: { p_source_id: string }
        Returns: undefined
      }
      get_attribution_analytics: {
        Args: { p_filters?: Json; p_organization_id: string }
        Returns: Json
      }
      get_billing_subscription: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_billing_usage: { Args: { p_organization_id: string }; Returns: Json }
      get_draft_review: { Args: { p_draft_id: string }; Returns: Json }
      get_draft_usage: { Args: { p_organization_id: string }; Returns: Json }
      get_notification_preferences: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_opportunity_usage: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      get_organization_activity: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_limit?: number
          p_organization_id: string
        }
        Returns: Json
      }
      get_organization_export: { Args: { p_request_id: string }; Returns: Json }
      get_organization_plan: {
        Args: { p_organization_id: string }
        Returns: {
          plan_key: Database["public"]["Enums"]["plan_key"]
          seat_limit: number
          seats_reserved: number
          seats_used: number
          status: string
          trial_ends_at: string
        }[]
      }
      get_organization_settings: {
        Args: { p_organization_id: string }
        Returns: {
          billing_email: string
          created_at: string
          default_currency: string
          id: string
          name: string
          slug: string
          status: string
          timezone: string
          trial_ends_at: string
          trial_started_at: string
          updated_at: string
        }[]
      }
      get_tracking_settings: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      invite_member: {
        Args: {
          p_email: string
          p_organization_id: string
          p_role: Database["public"]["Enums"]["organization_role"]
          p_token_hash: string
        }
        Returns: string
      }
      list_conversion_api_keys: {
        Args: { p_brand_id: string; p_organization_id: string }
        Returns: Json
      }
      list_extension_sessions: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      list_notification_deliveries: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      list_organization_data_requests: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      list_organization_members: {
        Args: { p_organization_id: string }
        Returns: {
          avatar_url: string
          email: string
          full_name: string
          joined_at: string
          role: Database["public"]["Enums"]["organization_role"]
          user_id: string
        }[]
      }
      manage_mock_subscription: {
        Args: {
          p_action: string
          p_organization_id: string
          p_plan_key?: string
        }
        Returns: Json
      }
      mark_draft_published: {
        Args: {
          p_comment_url: string
          p_draft_id: string
          p_expected_version: number
          p_organization_id: string
        }
        Returns: undefined
      }
      opportunity_workflow_status: {
        Args: {
          p_opportunity: Database["public"]["Tables"]["opportunities"]["Row"]
        }
        Returns: string
      }
      platform_admin_jobs: {
        Args: {
          p_before?: string
          p_before_id?: string
          p_family?: string
          p_limit?: number
          p_organization_id?: string
          p_status?: string
        }
        Returns: Json
      }
      platform_admin_organization: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      platform_admin_organizations: {
        Args: { p_after?: string; p_limit?: number }
        Returns: Json
      }
      platform_admin_overview: { Args: never; Returns: Json }
      platform_admin_retry_job: {
        Args: {
          p_family: string
          p_job_id: string
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      platform_admin_session: { Args: never; Returns: boolean }
      platform_admin_set_organization_status: {
        Args: {
          p_organization_id: string
          p_paused: boolean
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      record_draft_copy: {
        Args: { p_draft_id: string; p_expected_version: number }
        Returns: undefined
      }
      refresh_brand_subreddit: {
        Args: { p_id: string; p_kind: string }
        Returns: string
      }
      regenerate_draft: {
        Args: {
          p_draft_id: string
          p_expected_version: number
          p_idempotency_key: string
          p_options: Json
        }
        Returns: string
      }
      reject_draft: {
        Args: {
          p_draft_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: undefined
      }
      remove_brand_subreddit: { Args: { p_id: string }; Returns: undefined }
      remove_member: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: undefined
      }
      request_draft: {
        Args: {
          p_idempotency_key: string
          p_opportunity_id: string
          p_options: Json
        }
        Returns: string
      }
      request_organization_data: {
        Args: { p_kind: string; p_organization_id: string }
        Returns: string
      }
      rescore_opportunity: { Args: { p_id: string }; Returns: string }
      restore_draft_version: {
        Args: {
          p_draft_id: string
          p_expected_version: number
          p_restore_version: number
        }
        Returns: number
      }
      retry_knowledge_source: {
        Args: { p_source_id: string }
        Returns: undefined
      }
      revoke_conversion_api_key: {
        Args: { p_id: string; p_organization_id: string }
        Returns: undefined
      }
      revoke_extension_sessions: {
        Args: { p_organization_id: string; p_session_id?: string }
        Returns: number
      }
      revoke_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      revoke_organization_export: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      revoke_tracking_link: {
        Args: { p_id: string; p_organization_id: string }
        Returns: undefined
      }
      save_brand: {
        Args: { p_id: string; p_organization_id: string; p_profile: Json }
        Returns: string
      }
      save_brand_keyword: {
        Args: { p_brand_id: string; p_id: string; p_input: Json }
        Returns: string
      }
      save_draft_edit: {
        Args: {
          p_content: string
          p_draft_id: string
          p_expected_version: number
        }
        Returns: number
      }
      search_knowledge:
        | {
            Args: { p_brand_id: string; p_embedding: string; p_query: string }
            Returns: {
              content: string
              document_id: string
              id: string
              page_number: number
              score: number
              source_id: string
              source_url: string
              title: string
            }[]
          }
        | {
            Args: {
              p_brand_id: string
              p_embedding: string
              p_embedding_identity: string
              p_query: string
            }
            Returns: {
              content: string
              document_id: string
              id: string
              page_number: number
              score: number
              source_id: string
              source_url: string
              title: string
            }[]
          }
      set_knowledge_document_included: {
        Args: { p_document_id: string; p_included: boolean }
        Returns: undefined
      }
      set_notification_preferences: {
        Args: { p_organization_id: string; p_preferences: Json }
        Returns: Json
      }
      set_opportunity_status: {
        Args: { p_id: string; p_reason?: string; p_status: string }
        Returns: undefined
      }
      submit_draft_feedback: {
        Args: { p_draft_id: string; p_notes: string; p_rating: string }
        Returns: string
      }
      update_brand_persona: {
        Args: { p_brand_id: string; p_input: Json }
        Returns: string
      }
      update_brand_subreddit: {
        Args: { p_id: string; p_settings: Json }
        Returns: undefined
      }
      update_organization: {
        Args: {
          p_billing_email?: string
          p_default_currency?: string
          p_name: string
          p_organization_id: string
          p_timezone?: string
        }
        Returns: undefined
      }
      update_tracking_settings: {
        Args: { p_consent: string; p_days: number; p_organization_id: string }
        Returns: Json
      }
      verify_draft: {
        Args: { p_draft_id: string; p_expected_version: number }
        Returns: string
      }
      worker_knowledge_dispatch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          id: string
        }[]
      }
      worker_lock_knowledge_organization: {
        Args: { p_job_id: string }
        Returns: boolean
      }
    }
    Enums: {
      organization_role: "owner" | "admin" | "member" | "viewer"
      plan_key: "trial" | "solo" | "growth"
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
      organization_role: ["owner", "admin", "member", "viewer"],
      plan_key: ["trial", "solo", "growth"],
    },
  },
} as const

