import pLimit from "p-limit";
import * as operatorsRepo from "../operators/operators.repository.js";

const TERMINAL_TIMEOUT_MS = 5000;
const MAX_CONCURRENT = 10;

export interface TripSearchParams {
  origin: string;
  destination: string;
  date: string;
  passengers?: number;
}

export interface TerminalTrip {
  tripId: string;
  operatorId: string;
  operatorName: string;
  operatorSlug: string;
  origin: string;
  destination: string;
  departureDate: string;
  departureTime: string;
  arrivalTime: string;
  availableSeats: number;
  price: number;
  currency: string;
}

export interface SearchResult {
  trips: TerminalTrip[];
  errors: Array<{ operatorSlug: string; error: string }>;
  totalOperators: number;
  respondedOperators: number;
}

type OperatorRow = Awaited<ReturnType<typeof operatorsRepo.findAll>>["rows"][number];

async function fetchTripsFromTerminal(operator: OperatorRow, params: TripSearchParams): Promise<TerminalTrip[]> {
  const url = new URL(`${operator.apiUrl}/api/app/trips/search`);
  url.searchParams.set("origin", params.origin);
  url.searchParams.set("destination", params.destination);
  url.searchParams.set("date", params.date);
  if (params.passengers) url.searchParams.set("passengers", String(params.passengers));

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
    headers: { "X-Service-Key": operator.serviceKey, "Content-Type": "application/json" },
  });

  if (!res.ok) throw new Error(`Terminal returned HTTP ${res.status}`);

  const data = (await res.json()) as { trips?: unknown[] } | unknown[];
  const trips = Array.isArray(data) ? data : ((data as { trips?: unknown[] }).trips ?? []);

  return (trips as Array<Record<string, unknown>>).map((t) => ({
    tripId: `${operator.slug}:${String(t["id"] ?? t["tripId"] ?? "")}`,
    operatorId: operator.id,
    operatorName: operator.name,
    operatorSlug: operator.slug,
    origin: String(t["origin"] ?? params.origin),
    destination: String(t["destination"] ?? params.destination),
    departureDate: String(t["departureDate"] ?? params.date),
    departureTime: String(t["departureTime"] ?? t["departure_time"] ?? ""),
    arrivalTime: String(t["arrivalTime"] ?? t["arrival_time"] ?? ""),
    availableSeats: Number(t["availableSeats"] ?? t["available_seats"] ?? 0),
    price: Number(t["price"] ?? t["basePrice"] ?? 0),
    currency: String(t["currency"] ?? "IDR"),
  }));
}

export async function searchTrips(params: TripSearchParams): Promise<SearchResult> {
  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const limit = pLimit(MAX_CONCURRENT);
  const errors: Array<{ operatorSlug: string; error: string }> = [];

  const settled = await Promise.allSettled(
    operators.map((op) => limit(() => fetchTripsFromTerminal(op, params)))
  );

  const trips: TerminalTrip[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      trips.push(...result.value);
    } else {
      const op = operators[i];
      errors.push({
        operatorSlug: op?.slug ?? "unknown",
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  trips.sort((a, b) => a.price !== b.price ? a.price - b.price : a.departureTime.localeCompare(b.departureTime));
  return { trips, errors, totalOperators: operators.length, respondedOperators: operators.length - errors.length };
}

export async function getTripById(tripId: string): Promise<Record<string, unknown> | null> {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) return null;

  const operatorSlug = tripId.slice(0, colonIdx);
  const originalId = tripId.slice(colonIdx + 1);

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);
  if (!operator) return null;

  const res = await fetch(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(originalId)}`, {
    signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
    headers: { "X-Service-Key": operator.serviceKey },
  });

  if (!res.ok) return null;

  const trip = (await res.json()) as Record<string, unknown>;

  return {
    ...trip,
    tripId: `${operator.slug}:${originalId}`,
    operatorId: operator.id,
    operatorName: operator.name,
    operatorSlug: operator.slug,
    price: Number(trip["price"] ?? trip["basePrice"] ?? 0),
  };
}

export async function getCities(): Promise<{ cities: string[]; byOperator: Array<{ operatorSlug: string; cities: string[] }> }> {
  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const limit = pLimit(MAX_CONCURRENT);
  const allCities = new Set<string>();
  const byOperator: Array<{ operatorSlug: string; cities: string[] }> = [];

  await Promise.allSettled(
    operators.map((op) =>
      limit(async () => {
        try {
          const res = await fetch(`${op.apiUrl}/api/app/cities`, {
            signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
            headers: { "X-Service-Key": op.serviceKey },
          });
          if (!res.ok) return;
          const data = (await res.json()) as { cities?: string[] } | string[];
          const cities = Array.isArray(data) ? data : (data.cities ?? []);
          cities.forEach((c) => allCities.add(c));
          byOperator.push({ operatorSlug: op.slug, cities });
        } catch {
          // Skip terminals that are down
        }
      })
    )
  );

  return { cities: Array.from(allCities).sort(), byOperator };
}
