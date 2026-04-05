import pLimit from "p-limit";
import * as operatorsRepo from "../operators/operators.repository.js";

const TERMINAL_TIMEOUT_MS = 15000;
const MAX_CONCURRENT = 10;

const CACHE_TTL = {
  SEATMAP: 45 * 1000,
  SEARCH: 90 * 1000,
  CITIES: 5 * 60 * 1000,
  SERVICE_LINES: 5 * 60 * 1000,
  OPERATOR_INFO: 15 * 60 * 1000,
} as const;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = {
  search: new Map<string, CacheEntry<SearchResult>>(),
  tripContext: new Map<string, { originCity: string; destCity: string; serviceDate: string }>(),
  seatmap: new Map<string, CacheEntry<Record<string, unknown>>>(),
  cities: null as CacheEntry<{ cities: string[]; byOperator: Array<{ operatorSlug: string; cities: string[] }> }> | null,
  serviceLines: null as CacheEntry<{ serviceLines: Array<Record<string, unknown>>; byOperator: Array<{ operatorSlug: string; serviceLines: Array<Record<string, unknown>> }> }> | null,
  operatorInfo: new Map<string, CacheEntry<Record<string, unknown>>>(),
  materializedIds: new Map<string, string>(),
};

function getCached<T>(entry: CacheEntry<T> | undefined | null): T | null {
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function cleanMap<T>(map: Map<string, CacheEntry<T>>): void {
  const now = Date.now();
  for (const [key, entry] of map) {
    if (now > entry.expiresAt) map.delete(key);
  }
}

setInterval(() => {
  cleanMap(cache.search);
  cleanMap(cache.seatmap);
  cleanMap(cache.operatorInfo);
}, 60_000);

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

function mapTripDetail(operator: OperatorRow, t: Record<string, unknown>): TerminalTrip {
  const stops = t["stops"] as Array<Record<string, unknown>> | undefined;
  if (stops && Array.isArray(stops) && stops.length >= 2 && !t["origin"]) {
    const firstStop = stops[0];
    const lastStop = stops[stops.length - 1];

    const seatAvail = t["seatAvailability"] as Record<string, unknown> | undefined;
    const availableSeats = seatAvail
      ? Number(seatAvail["available"] ?? 0)
      : Number(t["availableSeats"] ?? t["capacity"] ?? 0);

    const rebuilt: Record<string, unknown> = {
      ...t,
      origin: {
        stopId: String(firstStop["stopId"] ?? ""),
        name: String(firstStop["name"] ?? ""),
        city: String(firstStop["city"] ?? ""),
        sequence: Number(firstStop["sequence"] ?? 1),
        departAt: firstStop["departAt"] ?? null,
        arriveAt: firstStop["arriveAt"] ?? null,
      },
      destination: {
        stopId: String(lastStop["stopId"] ?? ""),
        name: String(lastStop["name"] ?? ""),
        city: String(lastStop["city"] ?? ""),
        sequence: Number(lastStop["sequence"] ?? stops.length),
        departAt: lastStop["departAt"] ?? null,
        arriveAt: lastStop["arriveAt"] ?? null,
      },
      availableSeats,
      farePerPerson: Number(t["farePerPerson"] ?? 0),
    };
    return mapTrip(operator, rebuilt);
  }
  return mapTrip(operator, t);
}

async function resolveOperator(tripId: string): Promise<{ operator: OperatorRow; originalId: string; operatorSlug: string; isVirtual: boolean } | null> {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) return null;

  const operatorSlug = tripId.slice(0, colonIdx);
  const originalId = tripId.slice(colonIdx + 1);
  const isVirtual = originalId.startsWith("virtual-");

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);
  if (!operator) return null;

  return { operator, originalId, operatorSlug, isVirtual };
}

async function materializeTrip(
  operator: OperatorRow,
  virtualId: string,
  serviceDate: string
): Promise<string> {
  const cacheKey = `${operator.slug}:${virtualId}:${serviceDate}`;
  const cached = cache.materializedIds.get(cacheKey);
  if (cached) return cached;

  const baseId = virtualId.replace(/^virtual-/, "");

  try {
    const res = await fetch(`${operator.apiUrl}/api/app/trips/materialize`, {
      method: "POST",
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: {
        "X-Service-Key": operator.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ baseId, serviceDate }),
    });

    if (res.status === 404) {
      console.warn(`[gateway] Materialize endpoint not available on ${operator.slug}, trying detail fallback`);
      return await materializeFallback(operator, virtualId, serviceDate, cacheKey);
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = String(errBody["error"] ?? errBody["message"] ?? `HTTP ${res.status}`);
      throw new GatewayError(errMsg, res.status);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const realTripId = String(body["tripId"] ?? "");
    if (!realTripId) {
      throw new GatewayError("Terminal tidak mengembalikan tripId.", 502);
    }

    cache.materializedIds.set(cacheKey, realTripId);
    return realTripId;
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    console.warn(`[gateway] Materialize failed for ${operator.slug}, trying fallback:`, e instanceof Error ? e.message : e);
    return await materializeFallback(operator, virtualId, serviceDate, cacheKey);
  }
}

async function materializeFallback(
  operator: OperatorRow,
  virtualId: string,
  serviceDate: string,
  cacheKey: string
): Promise<string> {
  const detailUrl = new URL(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(virtualId)}`);
  detailUrl.searchParams.set("serviceDate", serviceDate);

  try {
    const res = await fetch(detailUrl.toString(), {
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey },
    });

    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      const realId = String(body["tripId"] ?? body["id"] ?? "");
      if (realId && !realId.startsWith("virtual-")) {
        cache.materializedIds.set(cacheKey, realId);
        return realId;
      }
    }
  } catch {
  }

  return virtualId;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

function translateError(err: unknown, context: string): GatewayError {
  const msg = err instanceof Error ? err.message : String(err);
  const statusCode = err instanceof GatewayError ? err.statusCode : 502;

  if (msg.includes("not found") || msg.includes("Trip not found")) {
    return new GatewayError("Perjalanan tidak ditemukan. Silakan cari ulang.", 404, "NOT_FOUND");
  }
  if (msg.includes("not eligible") || msg.includes("base-not-eligible")) {
    return new GatewayError("Jadwal tidak tersedia untuk tanggal ini.", 422, "NOT_ELIGIBLE");
  }
  if (msg.includes("seat") && (msg.includes("unavailable") || msg.includes("not available") || msg.includes("already"))) {
    return new GatewayError("Kursi sudah tidak tersedia. Silakan pilih kursi lain.", 409, "SEAT_UNAVAILABLE");
  }
  if (msg.includes("Validation") || msg.includes("Invalid") || msg.includes("required")) {
    return new GatewayError("Data yang dikirim tidak valid. Silakan periksa kembali.", 400, "VALIDATION_ERROR");
  }
  if (msg.includes("Unauthorized") || msg.includes("Service-Key") || msg.includes("INVALID_SERVICE_KEY")) {
    console.error(`[gateway] Auth error with terminal (${context}):`, msg);
    return new GatewayError("Terjadi gangguan koneksi dengan operator.", 502, "AUTH_ERROR");
  }
  if (msg.includes("timeout") || msg.includes("TIMEOUT") || msg.includes("AbortError")) {
    console.error(`[gateway] Timeout (${context}):`, msg);
    return new GatewayError("Layanan sedang sibuk. Coba lagi nanti.", 504, "TIMEOUT");
  }
  if (statusCode >= 500 || msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    console.error(`[gateway] Terminal error (${context}):`, msg);
    return new GatewayError("Terjadi kesalahan sistem. Coba lagi nanti.", 502, "TERMINAL_ERROR");
  }

  console.error(`[gateway] Unhandled error (${context}):`, msg);
  return new GatewayError("Terjadi kesalahan. Coba lagi nanti.", statusCode >= 400 ? statusCode : 502, "UNKNOWN");
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
  const searchKey = `${params.originCity}|${params.destinationCity}|${params.date}|${params.passengers ?? ""}`;
  const cached = getCached(cache.search.get(searchKey));
  if (cached) return cached;

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

  for (const trip of trips) {
    cache.tripContext.set(trip.tripId, {
      originCity: params.originCity,
      destCity: params.destinationCity,
      serviceDate: trip.serviceDate,
    });
  }

  trips.sort((a, b) =>
    a.farePerPerson !== b.farePerPerson
      ? a.farePerPerson - b.farePerPerson
      : (a.origin.departureTime ?? "").localeCompare(b.origin.departureTime ?? "")
  );

  const result: SearchResult = { trips, errors, totalOperators: operators.length, respondedOperators: operators.length - errors.length };

  cache.search.set(searchKey, { data: result, expiresAt: Date.now() + CACHE_TTL.SEARCH });
  return result;
}

export async function getTripById(tripId: string, serviceDate?: string): Promise<Record<string, unknown> | null> {
  const resolved = await resolveOperator(tripId);
  if (!resolved) return null;
  const { operator, originalId, operatorSlug, isVirtual } = resolved;

  let realId = originalId;

  if (isVirtual) {
    if (!serviceDate) {
      const ctx = cache.tripContext.get(tripId);
      serviceDate = ctx?.serviceDate;
    }
    if (!serviceDate) {
      throw new GatewayError("Parameter serviceDate diperlukan untuk jadwal virtual.", 400, "MISSING_SERVICE_DATE");
    }

    try {
      realId = await materializeTrip(operator, originalId, serviceDate);
    } catch (e) {
      throw translateError(e, `materialize ${tripId}`);
    }
  }

  const url = new URL(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(realId)}`);
  if (serviceDate) {
    url.searchParams.set("serviceDate", serviceDate);
  }

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey },
    });

    if (!res.ok) {
      if (res.status === 404 && isVirtual && serviceDate) {
        return await getTripFromSearch(operator, operatorSlug, originalId, serviceDate);
      }
      if (res.status === 404) return null;
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errMsg = String(errBody["error"] ?? `HTTP ${res.status}`);
      if (isVirtual && serviceDate && (errMsg.includes("not been materialized") || errMsg.includes("not found"))) {
        return await getTripFromSearch(operator, operatorSlug, originalId, serviceDate);
      }
      throw translateError(new GatewayError(errMsg, res.status), `getTripDetail ${tripId}`);
    }

    const trip = (await res.json()) as Record<string, unknown>;
    const mapped = mapTripDetail(operator, trip);

    if (isVirtual) {
      return {
        ...mapped,
        tripId: `${operatorSlug}:${originalId}`,
        materializedTripId: realId !== originalId ? realId : undefined,
        raw: trip,
      };
    }

    return { ...mapped, raw: trip };
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    if (isVirtual && serviceDate) {
      try {
        return await getTripFromSearch(operator, operatorSlug, originalId, serviceDate);
      } catch {
      }
    }
    throw translateError(e, `getTripDetail ${tripId}`);
  }
}

async function getTripFromSearch(
  operator: OperatorRow,
  operatorSlug: string,
  virtualId: string,
  serviceDate: string
): Promise<Record<string, unknown> | null> {
  const ctx = cache.tripContext.get(`${operatorSlug}:${virtualId}`);
  if (!ctx) return null;

  const searchUrl = new URL(`${operator.apiUrl}/api/app/trips/search`);
  searchUrl.searchParams.set("originCity", ctx.originCity);
  searchUrl.searchParams.set("destinationCity", ctx.destCity);
  searchUrl.searchParams.set("date", serviceDate);

  try {
    const res = await fetch(searchUrl.toString(), {
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;

    const body = (await res.json()) as Record<string, unknown> | unknown[];
    const trips = Array.isArray(body) ? body : ((body as Record<string, unknown>).data ?? (body as Record<string, unknown>).trips ?? []) as unknown[];
    const match = (trips as Array<Record<string, unknown>>).find(
      (t) => String(t["tripId"] ?? "") === virtualId
    );
    if (!match) return null;

    const mapped = mapTrip(operator, match);
    return { ...mapped, raw: match };
  } catch {
    return null;
  }
}

export async function getSeatmap(
  tripId: string,
  originSeq: number,
  destinationSeq: number,
  serviceDate?: string
): Promise<Record<string, unknown> | null> {
  const resolved = await resolveOperator(tripId);
  if (!resolved) return null;
  const { operator, originalId, operatorSlug, isVirtual } = resolved;

  let resolvedDate = serviceDate;
  if (!resolvedDate) {
    const ctx = cache.tripContext.get(tripId);
    resolvedDate = ctx?.serviceDate;
  }

  const seatmapCacheKey = `${operatorSlug}:${originalId}:${originSeq}:${destinationSeq}:${resolvedDate ?? ""}`;
  const cachedSeatmap = getCached(cache.seatmap.get(seatmapCacheKey));
  if (cachedSeatmap) return cachedSeatmap;

  let realId = originalId;

  if (isVirtual) {
    if (!resolvedDate) {
      throw new GatewayError("Parameter serviceDate diperlukan untuk jadwal virtual.", 400, "MISSING_SERVICE_DATE");
    }

    try {
      realId = await materializeTrip(operator, originalId, resolvedDate);
    } catch (e) {
      throw translateError(e, `materialize for seatmap ${tripId}`);
    }
  }

  const url = new URL(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(realId)}/seatmap`);
  url.searchParams.set("originSeq", String(originSeq));
  url.searchParams.set("destinationSeq", String(destinationSeq));

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey },
    });

    if (!res.ok) {
      if (res.status === 404) return null;
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
      throw translateError(
        new GatewayError(String(errBody["error"] ?? `HTTP ${res.status}`), res.status),
        `getSeatmap ${tripId}`
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const result = {
      ...data,
      tripId: `${operatorSlug}:${originalId}`,
      operatorSlug,
      ...(isVirtual && realId !== originalId ? { materializedTripId: realId } : {}),
    };

    cache.seatmap.set(seatmapCacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL.SEATMAP });
    return result;
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw translateError(e, `getSeatmap ${tripId}`);
  }
}

export function invalidateSeatmapCache(tripId: string): void {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) return;
  const operatorSlug = tripId.slice(0, colonIdx);
  const originalId = tripId.slice(colonIdx + 1);
  const keyPrefix = `${operatorSlug}:${originalId}:`;

  for (const key of cache.seatmap.keys()) {
    if (key.startsWith(keyPrefix)) {
      cache.seatmap.delete(key);
    }
  }

  const materializedId = cache.materializedIds.get(`${operatorSlug}:${originalId}`);
  if (materializedId) {
    const matPrefix = `${operatorSlug}:${materializedId}:`;
    for (const key of cache.seatmap.keys()) {
      if (key.startsWith(matPrefix)) {
        cache.seatmap.delete(key);
      }
    }
  }

  cache.search.clear();
}

export async function getCities(): Promise<{ cities: string[]; byOperator: Array<{ operatorSlug: string; cities: string[] }> }> {
  const cached = getCached(cache.cities);
  if (cached) return cached;

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
        }
      })
    )
  );

  const result = { cities: Array.from(allCities).sort(), byOperator };
  cache.cities = { data: result, expiresAt: Date.now() + CACHE_TTL.CITIES };
  return result;
}

export async function getOperatorInfo(operatorSlug: string): Promise<Record<string, unknown> | null> {
  const cachedInfo = getCached(cache.operatorInfo.get(operatorSlug));
  if (cachedInfo) return cachedInfo;

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
    const result = {
      ...data,
      operatorId: operator.id,
      operatorSlug: operator.slug,
    };
    cache.operatorInfo.set(operatorSlug, { data: result, expiresAt: Date.now() + CACHE_TTL.OPERATOR_INFO });
    return result;
  } catch {
    return null;
  }
}

export async function getServiceLines(): Promise<{ serviceLines: Array<Record<string, unknown>>; byOperator: Array<{ operatorSlug: string; serviceLines: Array<Record<string, unknown>> }> }> {
  const cached = getCached(cache.serviceLines);
  if (cached) return cached;

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
        }
      })
    )
  );

  const result = { serviceLines: allLines, byOperator };
  cache.serviceLines = { data: result, expiresAt: Date.now() + CACHE_TTL.SERVICE_LINES };
  return result;
}

export async function getReviews(tripId: string): Promise<Record<string, unknown> | null> {
  const resolved = await resolveOperator(tripId);
  if (!resolved) return null;
  const { operator, originalId } = resolved;

  let realId = originalId;
  if (resolved.isVirtual) {
    const ctx = cache.tripContext.get(tripId);
    if (ctx?.serviceDate) {
      try {
        realId = await materializeTrip(operator, originalId, ctx.serviceDate);
      } catch {
        return { reviews: [], count: 0, avgRating: 0 };
      }
    } else {
      return { reviews: [], count: 0, avgRating: 0 };
    }
  }

  try {
    const res = await fetch(`${operator.apiUrl}/api/app/trips/${encodeURIComponent(realId)}/reviews`, {
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
