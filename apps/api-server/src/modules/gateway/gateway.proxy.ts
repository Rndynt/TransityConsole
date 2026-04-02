/**
 * Gateway Proxy — Phase 1
 *
 * Routes booking operations to the correct terminal based on tripId prefix.
 *
 * Convention: tripId = {operatorSlug}:{originalTripId}
 * Steps:
 *   1. Parse operatorSlug from tripId prefix
 *   2. Lookup operator record (apiUrl + serviceKey) from DB — serviceKey never exposed to client
 *   3. Forward request to terminal with X-Service-Key header
 *   4. Store booking record in Console DB for tracking & analytics
 *
 * See docs/IMPLEMENTATION.md § 9.4 Booking Proxy for full design.
 */
export {};
