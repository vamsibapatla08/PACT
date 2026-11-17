export type BookingCategory = 'hotel' | 'flight' | 'event'
export type BookingStatus = 'draft' | 'awaiting_booking_approval' | 'awaiting_split_approval' | 'awaiting_funding' | 'funded' | 'awaiting_host_confirmation' | 'booking_pending' | 'demo_confirmed' | 'failed' | 'cancelled' | 'expired'

export type DemoHotelOption = { id: string; title: string; city: string; description: string; nightly_cents: number; capacity: number; amenities: string[]; check_in: string; check_out: string; guest_count: number; nights: number; subtotal_cents: number; taxes_cents: number; fees_cents: number; total_cents: number; currency: string; demo: true; quote_expires_at: string }
export type BookingRecord = { booking_id: string; pact_id: string; category: BookingCategory; requirements: Record<string, unknown>; guest_count: number; budget_cents: number | null; currency: string; status: BookingStatus; created_at: string; updated_at: string }
export type BookingProposal = { proposal_id: string; booking_id: string; proposal_version: number; provider_ref: string; option: DemoHotelOption; total_cents: number; currency: string; quote_expires_at: string; fingerprint: string; created_at: string }
export type BookingApproval = { proposal_id: string; user_id: string; decision: 'approve' | 'reject'; created_at: string }
export type BookingSplit = { split_id: string; booking_id: string; proposal_id: string; split_version: number; split_type: 'equal' | 'custom'; total_cents: number; currency: string; status: 'open' | 'approved' | 'rejected' }
export type BookingSplitItem = { split_id: string; user_id: string; amount_cents: number }
export type BookingSplitApproval = { split_id: string; user_id: string; decision: 'approve' | 'reject'; created_at: string }
export type BookingConfirmation = { confirmation_id: string; booking_id: string; demo_confirmation_code: string; details: Record<string, unknown>; simulated: true; status: 'confirmed' | 'failed' | 'cancelled'; confirmed_at: string | null }
