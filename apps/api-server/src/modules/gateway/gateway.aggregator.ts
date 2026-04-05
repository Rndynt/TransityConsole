import pLimit from "p-limit";
import * as operatorsRepo from "../operators/operators.repository.js";

const TERMINAL_TIMEOUT_MS = 5000;
const MAX_CONCURRENT = 10;

export interface TripSearchParams {
  originCity: string;
  destinationCity: string;
  date: string;
  passengers?: number;
}

export interface TripStop {
  stopId: string;
  cityName: string;
  stopName: string;
  sequence: number;
  departureTime: string | null;
  arrivalTime: string | null;
}

export interface TerminalTrip {
  tripId: string;
  operatorId: string;
  operatorName: string;
  operatorSlug: string;
  operatorLogo: string | null;
  operatorColor: string | null;
  serviceDate: string;
  origin: TripStop;
  destination: TripStop;
  farePerPerson: number;
  availableSeats: number;
  isVirtual: boolean;
  vehicleClass: string | null;
  raw: Record<string, unknown>;
}

export interface SearchResult {
  trips: TerminalTrip[];
  errors: Array<{ operatorSlug: string; error: string }>;
  totalOperators: number;
  respondedOperators: number;
}

type OperatorRow = Awaited<ReturnType<typeof operatorsRepo.findAll>>["rows"][number];

function mapTrip(operator: OperatorRow, t: Record<string, unknown>): TerminalTrip {
  const rawOrigin = (t["origin"] ?? {}) as Record<string, unknown>;
  const rawDest = (t["destination"] ?? {}) as Record<string, unknown>;

  return {
    tripId: `${operator.slug}:${String(t["tripId"] ?? t["id"] ?? "")}`,
    operatorId: operator.id,
    operatorName: operator.name,
    operatorSlug: operator.slug,
    operatorLogo: operator.logoUrl ?? null,
    operatorColor: operator.primaryColor ?? null,
    serviceDate: String(t["serviceDate"] ?? t["departureDate"] ?? ""),
    origin: {
      stopId: String(rawOrigin["stopId"] ?? ""),
      cityName: String(rawOrigin["cityName"] ?? rawOrigin["city"] ?? t["originCity"] ?? ""),
      stopName: String(rawOrigin["stopName"] ?? rawOrigin["name"] ?? ""),
      sequence: Number(rawOrigin["sequence"] ?? 0),
      departureTime: rawOrigin["departureTime"] ? String(rawOrigin["departureTime"]) : String(t["departureTime"] ?? ""),
      arrivalTime: rawOrigin["arrivalTime"] ? String(rawOrigin["arrivalTime"]) : null,
    },
    destination: {
      stopId: String(rawDest["stopId"] ?? ""),
      cityName: String(rawDest["cityName"] ?? rawDest["city"] ?? t["destinationCity"] ?? ""),
      stopName: String(rawDest["stopName"] ?? rawDest["name"] ?? ""),
      sequence: Number(rawDest["sequence"] ?? 0),
      departureTime: rawDest["departureTime"] ? String(rawDest["departureTime"]) : null,
      arrivalTime: rawDest["arrivalTime"] ? String(rawDest["arrivalTime"]) : String(t["arrivalTime"] ?? ""),
    },
    farePerPerson: Number(t["farePerPerson"] ?? t["price"] ?? t["basePrice"] ?? 0),
    availableSeats: Number(t["availableSeats"] ?? t["available_seats"] ?? 0),
    isVirtual: Boolean(t["isVirtual"] ?? false),
    vehicleClass: t["vehicleClass"] ? String(t["vehicleClass"]) : null,
    raw: t,
  };
}

async function fetchTripsFromTerminal(operator: OperatorRow, params: TripSearchParams): Promise<TerminalTrip[]> {
  const url = new URL(`${operator.apiUrl}/api/app/trips/search`);
  url.searchParams.set("originCity", params.originCity);
  url.searchParams.set("destinationCity", params.destinationCity);
  url.searchParams.set("date", params.date);
  if (params.passengers) url.searchParams.set("passengers", String(params.passengers));

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
    headers: { "X-Service-Key": operator.serviceKey, "Content-Type": "application/json" },
  });

  if (!res.ok) throw new Error(`Terminal returned HTTP ${res.status}`);

  const body = (await res.json()) as { data?: unknown[]; trips?: unknown[] } | unknown[];
  const trips = Array.isArray(body)
    ? body
    : ((body as Record<string, unknown>).data ?? (body as Record<string, unknown>).trips ?? []) as unknown[];

  return (trips as Array<Record<string, unknown>>).map((t) => mapTrip(operator, t));
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

  trips.sort((a, b) => a.farePerPerson !== b.farePerPerson ? a.farePerPerson - b.farePerPerson : (a.origin.departureTime ?? "").localeCompare(b.origin.departureTime ?? ""));
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
    operatorLogo: operator.logoUrl ?? null,
    operatorColor: operator.primaryColor ?? null,
  };
}

export async function getSeatmap(
  tripId: string,
  originSeq: number,
  destinationSeq: number
): Promise<Record<string, unknown> | null> {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) return null;

  const operatorSlug = tripId.slice(0, colonIdx);
  const originalId = tripId.slice(colonIdx + 1);

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);
  if (!operator) return null;

  const url = new URL(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(originalId)}/seatmap`);
  url.searchParams.set("originSeq", String(originSeq));
  url.searchParams.set("destinationSeq", String(destinationSeq));

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
    headers: { "X-Service-Key": operator.serviceKey },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Terminal returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  return {
    ...data,
    tripId: `${operator.slug}:${originalId}`,
    operatorSlug: operator.slug,
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
          const body = (await res.json()) as { data?: string[]; cities?: string[] } | string[];
          const cities = Array.isArray(body) ? body : ((body as Record<string, unknown>).data ?? (body as Record<string, unknown>).cities ?? []) as string[];
          cities.forEach((c) => allCities.add(c));
          byOperator.push({ operatorSlug: op.slug, cities });
        } catch {
          // skip terminals that are down
        }
      })
    )
  );

  return { cities: Array.from(allCities).sort(), byOperator };
}

export async function getOperatorInfo(operatorSlug: string): Promise<Record<string, unknown> | null> {
  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);
  if (!operator) return null;

  try {
    const res = await fetch(`${operator.apiUrl}/api/app/operator-info`, {
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      ...data,
      operatorId: operator.id,
      operatorSlug: operator.slug,
    };
  } catch {
    return null;
  }
}

export async function getServiceLines(): Promise<{ serviceLines: Array<Record<string, unknown>>; byOperator: Array<{ operatorSlug: string; serviceLines: Array<Record<string, unknown>> }> }> {
  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const limit = pLimit(MAX_CONCURRENT);
  const allLines: Array<Record<string, unknown>> = [];
  const byOperator: Array<{ operatorSlug: string; serviceLines: Array<Record<string, unknown>> }> = [];

  await Promise.allSettled(
    operators.map((op) =>
      limit(async () => {
        try {
          const res = await fetch(`${op.apiUrl}/api/app/service-lines`, {
            signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
            headers: { "X-Service-Key": op.serviceKey },
          });
          if (!res.ok) return;
          const body = (await res.json()) as { data?: unknown[] } | unknown[];
          const lines = (Array.isArray(body) ? body : ((body as Record<string, unknown>).data ?? [])) as Array<Record<string, unknown>>;
          const tagged = lines.map((l) => ({ ...l, operatorId: op.id, operatorSlug: op.slug, operatorName: op.name }));
          allLines.push(...tagged);
          byOperator.push({ operatorSlug: op.slug, serviceLines: tagged });
        } catch {
          // skip
        }
      })
    )
  );

  return { serviceLines: allLines, byOperator };
}

export async function getReviews(tripId: string): Promise<Record<string, unknown> | null> {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) return null;

  const operatorSlug = tripId.slice(0, colonIdx);
  const originalId = tripId.slice(colonIdx + 1);

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);
  if (!operator) return null;

  try {
    const res = await fetch(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(originalId)}/reviews`, {
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
