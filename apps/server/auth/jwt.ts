import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = "HS256";

export async function signTeacherToken(teacherId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(teacherId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

/** Returns the teacher id, or null if the token is missing / invalid / expired. */
export async function verifyTeacherToken(
  token: string | undefined | null,
): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Pull a bearer token out of an Authorization header. */
export function bearer(header: string | null): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}
