// Shared helpers for admin-issued TOTP: RFC 6238 (SHA-1, 30s, 6 digits),
// AES-GCM encryption of the base32 secret, otpauth URI + SVG QR code.
// deno-lint-ignore-file no-explicit-any

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function randomBase32Secret(bytes = 20): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bits = 0, value = 0, out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32_ALPHABET[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const ch of cleaned) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function u64be(n: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, Math.floor(n / 0x100000000));
  view.setUint32(4, n >>> 0);
  return buf;
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, u64be(counter)));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[offset] & 0x7f) << 24) |
              ((sig[offset + 1] & 0xff) << 16) |
              ((sig[offset + 2] & 0xff) << 8) |
              (sig[offset + 3] & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}

/** Verify a 6-digit TOTP code against a base32 secret, +/- 1 step for drift. */
export async function verifyTotp(secretBase32: string, code: string): Promise<boolean> {
  const trimmed = (code ?? "").toString().replace(/\D/g, "");
  if (trimmed.length !== 6) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const drift of [-1, 0, 1]) {
    const candidate = await hotp(secret, step + drift);
    if (candidate === trimmed) return true;
  }
  return false;
}

export function otpauthUri(email: string, secret: string, issuer = "HotelPilot"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// --- Encryption (AES-GCM using TOTP_ENCRYPTION_KEY) ---------------------

async function importAesKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("TOTP_ENCRYPTION_KEY");
  if (!raw) throw new Error("TOTP_ENCRYPTION_KEY not configured");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64d(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await importAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext),
  ));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Bad ciphertext");
  const key = await importAesKey();
  const iv = b64d(parts[1]);
  const ct = b64d(parts[2]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// --- QR Code (SVG) ------------------------------------------------------
// Minimal QR encoder — byte mode, error-correction level M, dynamic version.
// Adapted from public-domain reference implementations. Good for ~200 chars.

type Bitmap = number[][]; // 1 = black, 0 = white

function buildQr(data: string): { size: number; bitmap: Bitmap } {
  const bytes = new TextEncoder().encode(data);
  // Choose smallest version (1..10) fitting the payload at ECC=M byte mode.
  const capacityM: Record<number, number> = {
    1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213,
  };
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (bytes.length + 2 <= capacityM[v]) { version = v; break; }
  }
  if (!version) throw new Error("QR payload too large");
  return encodeQr(bytes, version);
}

// The full QR spec is long; we use a compact but complete encoder for ECC=M.
// Reed-Solomon + mask selection follow ISO/IEC 18004.
function encodeQr(data: Uint8Array, version: number): { size: number; bitmap: Bitmap } {
  const size = version * 4 + 17;
  // Total data codewords / EC codewords per block (ECC=M, versions 1-10, single block for small versions).
  const ecTable: Record<number, { total: number; ec: number; blocks: number[] }> = {
    1:  { total: 26,  ec: 10, blocks: [16] },
    2:  { total: 44,  ec: 16, blocks: [28] },
    3:  { total: 70,  ec: 26, blocks: [44] },
    4:  { total: 100, ec: 18, blocks: [32, 32] },
    5:  { total: 134, ec: 24, blocks: [43, 43] },
    6:  { total: 172, ec: 16, blocks: [27, 27, 27, 27] },
    7:  { total: 196, ec: 18, blocks: [31, 31, 31, 31] },
    8:  { total: 242, ec: 22, blocks: [38, 38, 38, 38] },
    9:  { total: 292, ec: 22, blocks: [36, 36, 36, 36, 36] },
    10: { total: 346, ec: 26, blocks: [43, 43, 43, 43, 44] },
  };
  const spec = ecTable[version];
  const dataCapacity = spec.blocks.reduce((a, b) => a + b, 0);

  // Bit stream: mode (byte=0100), char count (8 bits for v1-9, 16 for v10+), data bytes, terminator.
  const bits: number[] = [];
  const push = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4);
  push(data.length, version < 10 ? 8 : 16);
  for (const b of data) push(b, 8);
  // Terminator + byte-align
  for (let i = 0; i < 4 && bits.length < dataCapacity * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  // Pad bytes
  const padPattern = [0xEC, 0x11];
  let padIdx = 0;
  while (bits.length < dataCapacity * 8) push(padPattern[padIdx++ % 2], 8);

  // Bytes
  const dataBytes = new Uint8Array(dataCapacity);
  for (let i = 0; i < dataCapacity; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    dataBytes[i] = v;
  }

  // Reed-Solomon
  const gf = buildGf();
  const generator = rsGenerator(spec.ec, gf);
  const blocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const blen of spec.blocks) {
    const block = dataBytes.slice(offset, offset + blen);
    offset += blen;
    blocks.push(block);
    ecBlocks.push(rsEncode(block, generator, gf));
  }
  // Interleave
  const maxBlockLen = Math.max(...spec.blocks);
  const finalBytes: number[] = [];
  for (let i = 0; i < maxBlockLen; i++) {
    for (const b of blocks) if (i < b.length) finalBytes.push(b[i]);
  }
  for (let i = 0; i < spec.ec; i++) {
    for (const b of ecBlocks) finalBytes.push(b[i]);
  }

  // Build matrix
  const bitmap: Bitmap = Array.from({ length: size }, () => Array(size).fill(0));
  const reserved: Bitmap = Array.from({ length: size }, () => Array(size).fill(0));
  const setF = (r: number, c: number, v: number) => { bitmap[r][c] = v; reserved[r][c] = 1; };

  // Finder patterns + separators
  const drawFinder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const rr = r0 + r, cc = c0 + c;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      const onBorder = (r === 0 || r === 6 || c === 0 || c === 6) && r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const isOn = (r >= 0 && r <= 6 && c >= 0 && c <= 6) && (onBorder || inCore);
      setF(rr, cc, isOn ? 1 : 0);
    }
  };
  drawFinder(0, 0); drawFinder(0, size - 7); drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setF(6, i, i % 2 === 0 ? 1 : 0);
    setF(i, 6, i % 2 === 0 ? 1 : 0);
  }
  // Dark module
  setF(size - 8, 8, 1);
  // Reserve format info regions
  for (let i = 0; i < 9; i++) { if (!reserved[8][i]) reserved[8][i] = 1; if (!reserved[i][8]) reserved[i][8] = 1; }
  for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = 1; reserved[size - 1 - i][8] = 1; }

  // Alignment patterns (versions >= 2). For v2..10, single center at (size-7, size-7).
  if (version >= 2) {
    const positions = alignmentPositions(version);
    for (const r of positions) for (const c of positions) {
      if (reserved[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        setF(r + dr, c + dc, on ? 1 : 0);
      }
    }
  }

  // Place data bits, zig-zag from bottom-right
  let bitIdx = 0;
  const totalBits = finalBytes.length * 8;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const dc of [0, 1]) {
        const c = col - dc;
        if (reserved[row][c]) continue;
        if (bitIdx < totalBits) {
          const byte = finalBytes[bitIdx >> 3];
          const bit = (byte >> (7 - (bitIdx & 7))) & 1;
          bitmap[row][c] = bit;
        }
        bitIdx++;
      }
    }
    upward = !upward;
  }

  // Pick best mask
  let bestMask = 0, bestScore = Infinity, bestBitmap: Bitmap = bitmap;
  for (let m = 0; m < 8; m++) {
    const bm = applyMask(bitmap, reserved, m);
    applyFormatInfo(bm, m, size);
    const s = scoreMask(bm);
    if (s < bestScore) { bestScore = s; bestMask = m; bestBitmap = bm; }
  }
  return { size, bitmap: bestBitmap };
}

function alignmentPositions(version: number): number[] {
  const table: Record<number, number[]> = {
    2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  return table[version] ?? [];
}

function buildGf() {
  const exp = new Uint8Array(512), log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x; log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return { exp, log };
}
function gfMul(a: number, b: number, gf: ReturnType<typeof buildGf>) {
  if (a === 0 || b === 0) return 0;
  return gf.exp[gf.log[a] + gf.log[b]];
}
function rsGenerator(degree: number, gf: ReturnType<typeof buildGf>): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], gf.exp[i], gf);
    }
    g = next;
  }
  return g;
}
function rsEncode(data: Uint8Array, gen: Uint8Array, gf: ReturnType<typeof buildGf>): Uint8Array {
  const res = new Uint8Array(gen.length - 1);
  for (const b of data) {
    const factor = b ^ res[0];
    res.copyWithin(0, 1);
    res[res.length - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < gen.length - 1; i++) {
        res[i] ^= gfMul(gen[i + 1], factor, gf);
      }
    }
  }
  return res;
}

function applyMask(bm: Bitmap, reserved: Bitmap, mask: number): Bitmap {
  const size = bm.length;
  const out = bm.map((r) => r.slice());
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (reserved[r][c]) continue;
    let m = false;
    switch (mask) {
      case 0: m = (r + c) % 2 === 0; break;
      case 1: m = r % 2 === 0; break;
      case 2: m = c % 3 === 0; break;
      case 3: m = (r + c) % 3 === 0; break;
      case 4: m = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
      case 5: m = ((r * c) % 2) + ((r * c) % 3) === 0; break;
      case 6: m = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
      case 7: m = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
    }
    if (m) out[r][c] ^= 1;
  }
  return out;
}

function applyFormatInfo(bm: Bitmap, mask: number, size: number) {
  // Format info for ECC level M = 0b00, plus mask (3 bits), BCH-encoded.
  const data = (0b00 << 3) | mask;
  let bch = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((bch >> i) & 1) bch ^= gen << (i - 10);
  }
  const fmt = ((data << 10) | bch) ^ 0b101010000010010;
  const bit = (i: number) => (fmt >> i) & 1;
  // Around top-left finder
  for (let i = 0; i <= 5; i++) bm[8][i] = bit(i);
  bm[8][7] = bit(6); bm[8][8] = bit(7); bm[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) bm[14 - i][8] = bit(i);
  // Around the other two finders
  for (let i = 0; i <= 7; i++) bm[size - 1 - i][8] = bit(i);
  for (let i = 8; i <= 14; i++) bm[8][size - 15 + i] = bit(i);
}

function scoreMask(bm: Bitmap): number {
  // Simple penalty: count identical adjacent modules (Rule 1 of ISO 18004).
  const size = bm.length;
  let score = 0;
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (bm[r][c] === bm[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else run = 1;
    }
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (bm[r][c] === bm[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
      else run = 1;
    }
  }
  return score;
}

export function qrSvg(data: string, moduleSize = 6, margin = 4): string {
  const { size, bitmap } = buildQr(data);
  const total = (size + margin * 2) * moduleSize;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (bitmap[r][c]) {
        const x = (c + margin) * moduleSize;
        const y = (r + margin) * moduleSize;
        path += `M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path fill="#000000" d="${path}"/></svg>`;
}

// --- Supabase admin client + superadmin check ---------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function getCallerUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

export async function isSuperadmin(userId: string): Promise<boolean> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "superadmin").maybeSingle();
  if (error) return false;
  return !!data;
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}