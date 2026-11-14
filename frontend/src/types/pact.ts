export type Profile = {
  id: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
}

export type PactSummary = {
  id: string
  name: string
  created_by: string
  created_at: string
  member_count: number | null
}

export type PactMember = {
  user_id: string
  role: 'host' | 'member'
  joined_at: string
  profile: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null
}

export type PactWorkspace = PactSummary & { members: PactMember[] }
