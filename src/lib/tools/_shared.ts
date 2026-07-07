import { z } from "zod";

/**
 * Shared Zod schema for LLM-supplied `vmHost` values.
 *
 * Accepts a dotted IPv4 address or a valid DNS hostname.
 * Rejects schemes (http://), ports (:8080), paths (/foo), spaces, and other
 * non-host strings, preventing SSRF via the bastion forward target.
 */
export const vmHostSchema = z
  .string()
  .regex(
    /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/,
    "invalid host",
  );
