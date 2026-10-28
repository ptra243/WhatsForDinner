
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "household_members": {
                  Row: {
                    "created_at": string,"household_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"household_id": string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"household_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "household_members_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"household_settings": {
                  Row: {
                    "household_id": string,"settings": NonNullable<Json>,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "household_id": string,"settings"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Update: {
                    "household_id"?: string,"settings"?: NonNullable<Json>,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "household_settings_household_id_fkey"
      columns: ["household_id"]
isOneToOne: true
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"households": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ingredients": {
                  Row: {
                    "allergens": (string)[],"created_at": string,"name": string,"section": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "allergens"?: (string)[],"created_at"?: string,"name": string,"section"?: string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "allergens"?: (string)[],"created_at"?: string,"name"?: string,"section"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"list_extras": {
                  Row: {
                    "added_by": string | null,"created_at": string,"household_id": string,"id": string,"name": string,"qty": number | null,"section": string,"unit": string,"week_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_by"?: string | null,"created_at"?: string,"household_id": string,"id"?: string,"name": string,"qty"?: number | null,"section"?: string,"unit"?: string,"week_start": string
                  }
                  Update: {
                    "added_by"?: string | null,"created_at"?: string,"household_id"?: string,"id"?: string,"name"?: string,"qty"?: number | null,"section"?: string,"unit"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "list_extras_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"list_marks": {
                  Row: {
                    "bought_qty": number | null,"bought_unit": string | null,"have_it": boolean,"household_id": string,"item_key": string,"status": string | null,"ticked": boolean,"updated_at": string,"updated_by": string | null,"week_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bought_qty"?: number | null,"bought_unit"?: string | null,"have_it"?: boolean,"household_id": string,"item_key": string,"status"?: string | null,"ticked"?: boolean,"updated_at"?: string,"updated_by"?: string | null,"week_start": string
                  }
                  Update: {
                    "bought_qty"?: number | null,"bought_unit"?: string | null,"have_it"?: boolean,"household_id"?: string,"item_key"?: string,"status"?: string | null,"ticked"?: boolean,"updated_at"?: string,"updated_by"?: string | null,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "list_marks_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"meal_plan_dishes": {
                  Row: {
                    "created_at": string,"day": string,"household_id": string,"id": string,"position": number,"recipe_id": string,"role": string,"servings": number,"swaps": NonNullable<Json>,"updated_at": string,"week_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"day": string,"household_id": string,"id"?: string,"position"?: number,"recipe_id": string,"role"?: string,"servings": number,"swaps"?: NonNullable<Json>,"updated_at"?: string,"week_start": string
                  }
                  Update: {
                    "created_at"?: string,"day"?: string,"household_id"?: string,"id"?: string,"position"?: number,"recipe_id"?: string,"role"?: string,"servings"?: number,"swaps"?: NonNullable<Json>,"updated_at"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meal_plan_dishes_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meal_plan_dishes_recipe_id_household_id_fkey"
      columns: ["recipe_id","household_id"]
isOneToOne: false
      referencedRelation: "recipes"
      referencedColumns: ["id","household_id"]
    }
                  ]
                },"meal_plan_nights": {
                  Row: {
                    "cooked": boolean,"day": string,"household_id": string,"skip_check": boolean,"updated_at": string,"week_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cooked"?: boolean,"day": string,"household_id": string,"skip_check"?: boolean,"updated_at"?: string,"week_start": string
                  }
                  Update: {
                    "cooked"?: boolean,"day"?: string,"household_id"?: string,"skip_check"?: boolean,"updated_at"?: string,"week_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meal_plan_nights_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"recipe_ingredients": {
                  Row: {
                    "id": string,"ingredient_slug": string,"note": string,"position": number,"qty": number | null,"recipe_id": string,"unit": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"ingredient_slug": string,"note"?: string,"position": number,"qty"?: number | null,"recipe_id": string,"unit": string
                  }
                  Update: {
                    "id"?: string,"ingredient_slug"?: string,"note"?: string,"position"?: number,"qty"?: number | null,"recipe_id"?: string,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_ingredients_ingredient_slug_fkey"
      columns: ["ingredient_slug"]
isOneToOne: false
      referencedRelation: "ingredients"
      referencedColumns: ["slug"]
    },{
      foreignKeyName: "recipe_ingredients_recipe_id_fkey"
      columns: ["recipe_id"]
isOneToOne: false
      referencedRelation: "recipes"
      referencedColumns: ["id"]
    }
                  ]
                },"recipe_steps": {
                  Row: {
                    "id": string,"position": number,"recipe_id": string,"text": string,"timer_mins": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"position": number,"recipe_id": string,"text": string,"timer_mins"?: number | null
                  }
                  Update: {
                    "id"?: string,"position"?: number,"recipe_id"?: string,"text"?: string,"timer_mins"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_steps_recipe_id_fkey"
      columns: ["recipe_id"]
isOneToOne: false
      referencedRelation: "recipes"
      referencedColumns: ["id"]
    }
                  ]
                },"recipes": {
                  Row: {
                    "active_mins": number | null,"course": string,"created_at": string,"created_by": string | null,"household_id": string,"id": string,"is_example": boolean,"name": string,"notes": string,"provides": (string)[],"rating": number | null,"serves": number,"slug": string,"source": string,"spice": number | null,"tags": (string)[],"total_mins": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active_mins"?: number | null,"course"?: string,"created_at"?: string,"created_by"?: string | null,"household_id": string,"id"?: string,"is_example"?: boolean,"name": string,"notes"?: string,"provides"?: (string)[],"rating"?: number | null,"serves"?: number,"slug": string,"source"?: string,"spice"?: number | null,"tags"?: (string)[],"total_mins"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "active_mins"?: number | null,"course"?: string,"created_at"?: string,"created_by"?: string | null,"household_id"?: string,"id"?: string,"is_example"?: boolean,"name"?: string,"notes"?: string,"provides"?: (string)[],"rating"?: number | null,"serves"?: number,"slug"?: string,"source"?: string,"spice"?: number | null,"tags"?: (string)[],"total_mins"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipes_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "create_household":
{ Args: { "household_name": string }; Returns: string
                           },
"move_night":
{ Args: { "from_day": string,"from_week": string,"hid": string,"to_day": string,"to_week": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
