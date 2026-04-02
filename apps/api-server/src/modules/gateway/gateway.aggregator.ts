/**
 * Gateway Aggregator — Phase 1
 *
 * Fan-out search: sends concurrent requests to all active operator terminals,
 * aggregates results, and returns a unified response to TransityApp.
 *
 * Flow:
 *   1. Fetch all active operators from DB
 *   2. Send concurrent search requests to each terminal (X-Service-Key header)
 *   3. Collect successful results — failed terminals are skipped (partial results OK)
 *   4. Normalize and sort results by departure time
 *   5. Prefix each tripId: {operatorSlug}:{originalTripId}
 *
 * See docs/IMPLEMENTATION.md § 9.3 Fan-Out Search for full design.
 */
export {};
