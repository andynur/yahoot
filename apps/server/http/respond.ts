import type { ZodType } from "zod";
import { env } from "../env";
import { bearer, verifyTeacherToken } from "../auth/jwt";
import type { SocketData } from "../socket";

/** Is this origin a local dev / LAN address we should allow in dev? */
function isLocalOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return (
      h === "localhost" ||
      h === "::1" ||
      h.endsWith(".local") ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch {
    return false;
  }
}

/**
 * In dev, reflect a local/LAN origin so a classroom on wifi works with no
 * config. In production the app is served same-origin, so only the configured
 * domain is ever allowed — reflecting private addresses there buys nothing and
 * widens the surface.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const reflect = !env.IS_PRODUCTION && origin && isLocalOrigin(origin);
  const allow = reflect ? origin : env.WEB_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    Vary: "Origin",
  };
}

export function applyCors(res: Response, origin: string | null): Response {
  for (const [k, v] of Object.entries(corsHeaders(origin)))
    res.headers.set(k, v);
  return res;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function preflight(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(req.headers.get("origin")),
      "Access-Control-Max-Age": "86400",
    },
  });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function toResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  console.error("unhandled route error:", err);
  return json({ error: "internal error" }, 500);
}

type RouteFn<P extends string> = (
  req: Bun.BunRequest<P>,
  server: Bun.Server<SocketData>,
) => Promise<Response> | Response;

/** Wrap a handler so thrown HttpErrors become clean JSON responses (with CORS). */
export function route<P extends string>(fn: RouteFn<P>): RouteFn<P> {
  return async (req, server) => {
    const origin = req.headers.get("origin");
    try {
      return applyCors(await fn(req, server), origin);
    } catch (err) {
      return applyCors(toResponse(err), origin);
    }
  };
}

export async function requireTeacher(req: Request): Promise<string> {
  const teacherId = await verifyTeacherToken(
    bearer(req.headers.get("authorization")),
  );
  if (!teacherId) throw new HttpError(401, "authentication required");
  return teacherId;
}

export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(
      422,
      `validation failed: ${result.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return result.data;
}
