import "@tanstack/react-start/server-only";
import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "@series-raqui/config";
import {
  getRequestIP,
  getSession,
  type SessionConfig,
  sealSession,
  updateSession,
} from "@tanstack/react-start/server";

const COOKIE_NAME = "series_raqui_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 5 * 60_000;

interface SessionData {
  authed?: boolean;
}

let cachedConfig: SessionConfig | undefined;

function sessionConfig(): SessionConfig {
  if (!cachedConfig) {
    cachedConfig = {
      name: COOKIE_NAME,
      password: loadConfig({ requireAuth: true }).sessionSecret,
      maxAge: MAX_AGE_SECONDS,
      // No queremos aceptar la sesión por cabecera, sólo por cookie.
      sessionHeader: false,
      // Escribimos Set-Cookie a mano porque respondemos con Response propias.
      cookie: false,
    };
  }
  return cachedConfig;
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    const session = await getSession<SessionData>(sessionConfig());
    return session.data.authed === true;
  } catch {
    // Una cookie corrupta o sellada con otra clave equivale a no estar dentro.
    return false;
  }
}

/**
 * Comparación en tiempo constante para no filtrar la contraseña por el reloj.
 */
function matchesPassword(candidate: string): boolean {
  const expected = Buffer.from(loadConfig({ requireAuth: true }).authPassword);
  const given = Buffer.from(candidate);
  if (given.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(given, expected);
}

const attempts = new Map<string, { count: number; retryAt: number }>();

function clientKey(): string {
  return getRequestIP({ xForwardedFor: true }) ?? "desconocido";
}

/** Milisegundos que faltan para poder reintentar, o 0 si se puede probar ya. */
export function lockoutRemainingMs(): number {
  const record = attempts.get(clientKey());
  if (!record || record.count < MAX_ATTEMPTS) return 0;
  return Math.max(0, record.retryAt - Date.now());
}

function registerFailure(): void {
  const key = clientKey();
  const record = attempts.get(key);
  const count = record && record.retryAt > Date.now() ? record.count + 1 : 1;
  attempts.set(key, { count, retryAt: Date.now() + LOCKOUT_MS });
}

export function attemptLogin(password: string): boolean {
  if (!matchesPassword(password)) {
    registerFailure();
    return false;
  }
  attempts.delete(clientKey());
  return true;
}

function serializeCookie(value: string, maxAge: number, secure: boolean) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function sessionCookie(secure: boolean): Promise<string> {
  const config = sessionConfig();
  await updateSession<SessionData>(config, { authed: true });
  return serializeCookie(await sealSession(config), MAX_AGE_SECONDS, secure);
}

export function expiredSessionCookie(secure: boolean): string {
  return serializeCookie("", 0, secure);
}
