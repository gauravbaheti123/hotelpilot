import { z } from "zod";

export const ID_PROOF_TYPES = ["aadhaar", "pan", "passport", "driving_license", "voter_id", "other"] as const;

export const guestSchema = z.object({
  name: z.string().trim().min(1, "Name required").max(120, "Too long"),
  mobile: z.string().trim().regex(/^\d{10}$/, "Enter a valid 10-digit mobile number").optional().or(z.literal("")),
  email: z.string().trim().email("Invalid email").max(255).optional().or(z.literal("")),
  gender: z.enum(["male", "female", "other", ""]).optional(),
  dob: z.string().optional().or(z.literal("")),
  nationality: z.string().trim().max(60).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  city: z.string().trim().max(80).optional().or(z.literal("")),
  state: z.string().trim().max(80).optional().or(z.literal("")),
  country: z.string().trim().max(80).optional().or(z.literal("")),
  pincode: z.string().trim().max(12).optional().or(z.literal("")),
  company: z.string().trim().max(200).optional().or(z.literal("")),
  gst_number: z.string().trim().max(20).optional().or(z.literal("")),
  id_proof_type: z.string().optional().or(z.literal("")),
  id_proof_number: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type GuestInput = z.infer<typeof guestSchema>;

export function emptyToNull<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: T[K] extends string | undefined ? string | null : T[K] } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v === "" || v === undefined ? null : v;
  }
  return out as { [K in keyof T]: T[K] extends string | undefined ? string | null : T[K] };
}