export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  wallet_address: string | null
  created_at: string
}

export interface Pact {
  id: string
  name: string
  created_by: string
  invite_code: string
  created_at: string
}

export interface PactMember {
  pact_id: string
  user_id: string
  role: 'host' | 'member'
  can_handle_money: boolean
  spend_cap_usdc: number | null
  joined_at: string
}

// A pact with member count — for dashboard display
export interface PactWithMemberCount extends Pact {
  member_count: number
  user_role: 'host' | 'member'
}
