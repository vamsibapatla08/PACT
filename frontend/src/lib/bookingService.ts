import { supabase } from './supabase'
import type { BookingApproval, BookingConfirmation, BookingProposal, BookingRecord, BookingSplit, BookingSplitApproval, BookingSplitItem, DemoHotelOption } from '../types/booking'

function client() { if (!supabase) throw new Error('Pact is not connected to Supabase yet.'); return supabase }
async function bookingErrorMessage(error: unknown) {
  const response = (error as { context?: unknown }).context
  if (response instanceof Response) {
    const body = await response.clone().json().catch(() => null) as { error?: unknown } | null
    const backendMessage = typeof body?.error === 'string' ? body.error : null
    return `${response.status}${backendMessage ? `: ${backendMessage}` : ''}`
  }
  return error instanceof Error ? error.message : 'Booking service is unavailable.'
}
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().functions.invoke('booking', { body })
  if (error) throw new Error(await bookingErrorMessage(error))
  if (!data) throw new Error('Booking service returned no data.')
  return data as T
}
export async function searchDemoHotels(input: { city: string; checkIn: string; checkOut: string; guestCount: number; budgetCents: number | null }) { return invoke<{ category: 'hotel'; demo: true; options: DemoHotelOption[] }>({ action: 'search', category: 'hotel', ...input }) }
export async function createBookingRequest(pactId: string, input: { requirements: Record<string, unknown>; guestCount: number; budgetCents: number | null; requestKey: string }) { return invoke<{ bookingId: string }>({ action: 'create_request', pactId, category: 'hotel', ...input }) }
export async function submitBookingProposal(pactId: string, bookingId: string, option: DemoHotelOption) { return invoke<{ proposalId: string }>({ action: 'create_proposal', pactId, bookingId, providerRef: option.id, option, totalCents: option.total_cents, quoteExpiresAt: option.quote_expires_at, fingerprint: `${option.id}:${option.check_in}:${option.check_out}:${option.guest_count}:${option.total_cents}` }) }
export async function castBookingApproval(pactId: string, proposalId: string, decision: 'approve' | 'reject') { return invoke<{ proposal: BookingProposal }>({ action: 'approve', pactId, proposalId, decision }) }
export async function createBookingSplit(pactId: string, bookingId: string, proposalId: string) { return invoke<{ splitId: string; splitType: 'equal' }>({ action: 'create_split', pactId, bookingId, proposalId, splitType: 'equal' }) }
export async function castBookingSplitApproval(pactId: string, splitId: string, decision: 'approve' | 'reject') { return invoke<{ split: BookingSplit }>({ action: 'approve_split', pactId, splitId, decision }) }
export async function associateBookingPayment(pactId: string, bookingId: string, splitId: string, paymentId: string) { return invoke<{ associationId: string }>({ action: 'associate_payment', pactId, bookingId, splitId, paymentId }) }
export async function finalizeDemoBooking(pactId: string, bookingId: string, proposalId: string, splitId: string, paymentId: string, idempotencyKey: string) { return invoke<{ status: 'demo_confirmed'; syncStatus: 'synchronized' | 'pending_sync'; syncError?: string | null; confirmation?: BookingConfirmation }>({ action: 'finalize', pactId, bookingId, proposalId, splitId, paymentId, idempotencyKey }) }
export async function reconcileBooking(pactId: string, bookingId: string) { return invoke<{ status: 'synchronized'; confirmationId: string }>({ action: 'reconcile', pactId, bookingId }) }
export async function getBookingStatus(pactId: string, bookingId: string) { return invoke<{ booking: BookingRecord; proposals: BookingProposal[]; approvals: BookingApproval[]; splits: BookingSplit[]; splitItems: BookingSplitItem[]; splitApprovals: BookingSplitApproval[]; confirmations: BookingConfirmation[]; demo: true }>({ action: 'status', pactId, bookingId }) }
export async function getLatestBookingStatus(pactId: string) { return invoke<{ booking: BookingRecord | null; proposals: BookingProposal[]; approvals: BookingApproval[]; splits: BookingSplit[]; splitItems: BookingSplitItem[]; splitApprovals: BookingSplitApproval[]; confirmations: BookingConfirmation[]; demo: true }>({ action: 'latest', pactId }) }
export async function cancelBooking(pactId: string, bookingId: string) { return invoke<{ booking: BookingRecord }>({ action: 'cancel', pactId, bookingId }) }
