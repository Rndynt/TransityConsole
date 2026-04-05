import pLimit from "p-limit";
import * as operatorsRepo from "../operators/operators.repository.js";

const TERMINAL_TIMEOUT_MS = 15000;
const MAX_CONCURRENT = 10;

const tripCache = new Map<string, { originCity: string; destCity: string; serviceDate: string }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
let lastCacheClean = Date.now();

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

function findCityFromStops(stops: unknown, stopId: string): string {
  if (!Array.isArray(stops)) return "";
  const stop = stops.find((s: Record<string, unknown>) => String(s["stopId"] ?? "") === stopId);
  return stop ? String((stop as Record<string, unknown>)["city"] ?? "") : "";
}

function mapTrip(operator: OperatorRow, t: Record<string, unknown>): TerminalTrip {
  const rawOrigin = (t["origin"] ?? {}) as Record<string, unknown>;
  const rawDest = (t["destination"] ?? {}) as Record<string, unknown>;
  const stops = t["stops"];

  const originStopId = String(rawOrigin["stopId"] ?? "");
  const destStopId = String(rawDest["stopId"] ?? "");

  const originCity = String(
    rawOrigin["cityName"] ?? rawOrigin["city"] ?? t["originCity"] ?? findCityFromStops(stops, originStopId) ?? ""
  );
  const destCity = String(
    rawDest["cityName"] ?? rawDest["city"] ?? t["destinationCity"] ?? findCityFromStops(stops, destStopId) ?? ""
  );

  const originDepartureTime = rawOrigin["departureTime"] ?? rawOrigin["departAt"] ?? t["departureTime"] ?? null;
  const originArrivalTime = rawOrigin["arrivalTime"] ?? rawOrigin["arriveAt"] ?? null;
  const destDepartureTime = rawDest["departureTime"] ?? rawDest["departAt"] ?? null;
  const destArrivalTime = rawDest["arrivalTime"] ?? rawDest["arriveAt"] ?? t["arrivalTime"] ?? null;

  return {
    tripId: `${operator.slug}:${String(t["tripId"] ?? t["id"] ?? "")}`,
    operatorId: operator.id,
    operatorName: operator.name,
    operatorSlug: operator.slug,
    operatorLogo: operator.logoUrl ?? null,
    operatorColor: operator.primaryColor ?? null,
    serviceDate: String(t["serviceDate"] ?? t["departureDate"] ?? ""),
    origin: {
      stopId: originStopId,
      cityName: originCity,
      stopName: String(rawOrigin["stopName"] ?? rawOrigin["name"] ?? ""),
      sequence: Number(rawOrigin["sequence"] ?? 0),
      departureTime: originDepartureTime ? String(originDepartureTime) : null,
      arrivalTime: originArrivalTime ? String(originArrivalTime) : null,
    },
    destination: {
      stopId: destStopId,
      cityName: destCity,
      stopName: String(rawDest["stopName"] ?? rawDest["name"] ?? ""),
      sequence: Number(rawDest["sequence"] ?? 0),
      departureTime: destDepartureTime ? String(destDepartureTime) : null,
      arrivalTime: destArrivalTime ? String(destArrivalTime) : null,
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

  if (Date.now() - lastCacheClean > CACHE_TTL_MS) {
    tripCache.clear();
    lastCacheClean = Date.now();
  }
  for (const trip of trips) {
    tripCache.set(trip.tripId, {
      originCity: params.originCity,
      destCity: params.destinationCity,
      serviceDate: trip.serviceDate,
    });
  }

  trips.sort((a, b) => a.farePerPerson !== b.farePerPerson ? a.farePerPerson - b.farePerPerson : (a.origin.departureTime ?? "").localeCompare(b.origin.departureTime ?? ""));
  return { trips, errors, totalOperators: operators.length, respondedOperators: operators.length - errors.length };
}

export async function getTripById(tripId: string, serviceDate?: string): Promise<Record<string, unknown> | null> {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) return null;

  const operatorSlug = tripId.slice(0, colonIdx);
  const originalId = tripId.slice(colonIdx + 1);
  const isVirtual = originalId.startsWith("virtual-");

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);
  if (!operator) return null;

  if (isVirtual && serviceDate) {
    const searchUrl = new URL(`${operator.apiUrl}/api/app/trips/search`);
    const rawOriginCity = tripCache.get(tripId)?.originCity;
    const rawDestCity = tripCache.get(tripId)?.destCity;
    if (rawOriginCity && rawDestCity) {
      searchUrl.searchParams.set("originCity", rawOriginCity);
      searchUrl.searchParams.set("destinationCity", rawDestCity);
    } else {
      searchUrl.searchParams.set("originCity", "");
      searchUrl.searchParams.set("destinationCity", "");
    }
    searchUrl.searchParams.set("date", serviceDate);

    try {
      const searchRes = await fetch(searchUrl.toString(), {
        signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
        headers: { "X-Service-Key": operator.serviceKey, "Content-Type": "application/json" },
      });
      if (searchRes.ok) {
        const body = (await searchRes.json()) as Record<string, unknown> | unknown[];
        const trips = Array.isArray(body) ? body : ((body as Record<string, unknown>).data ?? (body as Record<string, unknown>).trips ?? []) as unknown[];
        const match = (trips as Array<Record<string, unknown>>).find(
          (t) => String(t["tripId"] ?? "") === originalId
        );
        if (match) {
          const mapped = mapTrip(operator, match);
          return { ...mapped, raw: match };
        }
      }
    } catch {
      // fall through to direct fetch
    }
  }

  const url = new URL(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(originalId)}`);
  if (isVirtual && serviceDate) {
    url.searchParams.set("serviceDate", serviceDate);
  }

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey },
    });

    if (!res.ok) return null;

    const trip = (await res.json()) as Record<string, unknown>;
    const mapped = mapTrip(operator, trip);
    return { ...mapped, raw: trip };
  } catch {
    return null;
  }
}

function generateDefaultSeatmap(
  vehicleClass: string,
  capacity: number,
  tripId: string,
  operatorSlug: string
): Record<string, unknown> {
  const cols = vehicleClass.includes("premio") ? 3 : 3;
  const rows = Math.ceil(capacity / cols);
  const seatMap: Array<{ col: number; row: number; class: string; seat_no: string }> = [];
  const seatAvailability: Record<string, { available: boolean; held: boolean }> = {};
  const letters = ["A", "B", "C", "D"];

  let count = 0;
  for (let r = 1; r <= rows && count < capacity; r++) {
    for (let c = 1; c <= cols && count < capacity; c++) {
      const seatNo = `${r}${letters[c - 1] ?? String(c)}`;
      seatMap.push({ col: c, row: r, class: vehicleClass.split("-")[0] ?? "commuter", seat_no: seatNo });
      seatAvailability[seatNo] = { available: true, held: false };
      count++;
    }
  }

  return {
    layout: { rows, cols, seatMap },
    seatAvailability,
    tripId,
    operatorSlug,
    isVirtual: true,
  };
}

export async function getSeatmap(
  tripId: string,
  originSeq: number,
  destinationSeq: number,
  serviceDate?: string
): Promise<Record<string, unknown> | null> {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) return null;

  const operatorSlug = tripId.slice(0, colonIdx);
  const originalId = tripId.slice(colonIdx + 1);
  const isVirtual = originalId.startsWith("virtual-");

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);
  if (!operator) return null;

  if (isVirtual) {
    if (!serviceDate) {
      throw new Error("serviceDate is required for virtual trip seatmaps");
    }

    const cached = tripCache.get(`${operatorSlug}:${originalId}`);
    if (cached) {
      const searchUrl = new URL(`${operator.apiUrl}/api/app/trips/search`);
      searchUrl.searchParams.set("originCity", cached.originCity);
      searchUrl.searchParams.set("destinationCity", cached.destCity);
      searchUrl.searchParams.set("date", serviceDate);

      try {
        const searchRes = await fetch(searchUrl.toString(), {
          signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
          headers: { "X-Service-Key": operator.serviceKey, "Content-Type": "application/json" },
        });
        if (searchRes.ok) {
          const body = (await searchRes.json()) as Record<string, unknown> | unknown[];
          const trips = Array.isArray(body) ? body : ((body as Record<string, unknown>).data ?? (body as Record<string, unknown>).trips ?? []) as unknown[];
          const match = (trips as Array<Record<string, unknown>>).find(
            (t) => String(t["tripId"] ?? "") === originalId
          );
          if (match) {
            const baseId = match["_baseId"] as string | undefined;
            if (baseId) {
              const seatUrl = new URL(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(baseId)}/seatmap`);
              seatUrl.searchParams.set("originSeq", String(originSeq));
              seatUrl.searchParams.set("destinationSeq", String(destinationSeq));
              const seatRes = await fetch(seatUrl.toString(), {
                signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
                headers: { "X-Service-Key": operator.serviceKey },
              });
              if (seatRes.ok) {
                const data = (await seatRes.json()) as Record<string, unknown>;
                return { ...data, tripId: `${operatorSlug}:${originalId}`, operatorSlug, isVirtual: true };
              }
            }

            const vehicleClass = String(match["vehicleClass"] ?? "commuter-14");
            const capacity = Number(match["availableSeats"] ?? 14);
            return generateDefaultSeatmap(vehicleClass, capacity, `${operatorSlug}:${originalId}`, operatorSlug);
          }
        }
      } catch {
        // fall through
      }
    }

    const vehicleClass = "commuter-14";
    return generateDefaultSeatmap(vehicleClass, 14, `${operatorSlug}:${originalId}`, operatorSlug);
  }

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
