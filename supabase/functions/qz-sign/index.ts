// Signs strings sent by QZ Tray's setSignaturePromise using our private key.
// The private key lives in the QZ_PRIVATE_KEY secret and is NEVER logged or
// returned. Response is a base64 RSA-SHA512 signature — qz-tray 2.1+ uses
// SHA-512 as the default signature algorithm.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
    false,
    ["sign"],
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
  try {
    const { toSign } = (await req.json()) as { toSign?: string };
    if (typeof toSign !== "string" || toSign.length === 0) {
      return new Response(JSON.stringify({ error: "toSign_required" }), {
        status: 400,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }
    console.log("[qz-sign] signing request received; payload length:", toSign.length);
    const pem = Deno.env.get("QZ_PRIVATE_KEY");
    if (!pem) {
      return new Response(JSON.stringify({ error: "private_key_not_configured" }), {
        status: 500,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }
    const key = await importPrivateKey(pem);
    const sig = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      new TextEncoder().encode(toSign),
    );
    return new Response(JSON.stringify({ signature: toBase64(sig) }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (err) {
    // Never log the private key. Only log the failure class.
    console.error("[qz-sign] signing failed:", (err as Error)?.name ?? "error");
    return new Response(JSON.stringify({ error: "sign_failed" }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});