// Upload a file to a shared Google Drive folder using a service account.
// Requires GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_DRIVE_FOLDER_ID_BRIJ (id_doc),
// and GOOGLE_DRIVE_FOLDER_ID_BRIJ_KOT (kot_proof).
// deno-lint-ignore-file no-explicit-any

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// TODO: extend with a property_id -> folder_id map when multi-property support lands.
function resolveFolderId(folderType: string): string | null {
  if (folderType === "id_doc") return Deno.env.get("GOOGLE_DRIVE_FOLDER_ID_BRIJ") ?? null;
  if (folderType === "kot_proof") return Deno.env.get("GOOGLE_DRIVE_FOLDER_ID_BRIJ_KOT") ?? null;
  return null;
}

function b64url(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = new TextEncoder().encode(input);
  else if (input instanceof Uint8Array) bytes = input;
  else bytes = new Uint8Array(input);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(): Promise<string> {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not configured");
  const key = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const pk = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(key.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pk,
    new TextEncoder().encode(signInput),
  );
  const jwt = `${signInput}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${t}`);
  }
  const j = await res.json();
  return j.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Diagnostic mode: report whether the configured folder lives on a Shared Drive
  // (driveId present) or in the service account's personal My Drive.
  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const folderType = url.searchParams.get("folderType") ?? "id_doc";
      const folderId = resolveFolderId(folderType);
      if (!folderId) throw new Error(`Folder not configured: ${folderType}`);
      const accessToken = await getAccessToken();
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true&fields=id,name,mimeType,driveId,ownedByMe,capabilities(canAddChildren)`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const meta = await metaRes.json();
      return new Response(
        JSON.stringify({
          success: metaRes.ok,
          folderType,
          status: metaRes.status,
          meta,
          isSharedDrive: Boolean(meta?.driveId),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: e?.message ?? String(e) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    // verify_jwt=true in supabase/config.toml already rejects unauthenticated requests.
    const form = await req.formData();
    const file = form.get("file");
    const folderType = String(form.get("folderType") ?? "");
    const fileName = String(form.get("fileName") ?? "").trim();

    if (!(file instanceof File)) throw new Error("Missing 'file'");
    if (!fileName) throw new Error("Missing 'fileName'");
    const folderId = resolveFolderId(folderType);
    if (!folderId) throw new Error(`Unknown folderType or folder not configured: ${folderType}`);
    if (file.size > 10 * 1024 * 1024) throw new Error("File exceeds 10MB");

    const accessToken = await getAccessToken();

    // Multipart upload — build body with a boundary manually.
    const boundary = `-------lovable-${crypto.randomUUID()}`;
    const metadata = { name: fileName, parents: [folderId] };
    const encoder = new TextEncoder();
    const preface = encoder.encode(
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    );
    const closer = encoder.encode(`\r\n--${boundary}--`);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const body = new Uint8Array(preface.length + fileBytes.length + closer.length);
    body.set(preface, 0);
    body.set(fileBytes, preface.length);
    body.set(closer, preface.length + fileBytes.length);

    const upRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!upRes.ok) {
      const t = await upRes.text();
      throw new Error(`Drive upload failed: ${upRes.status} ${t}`);
    }
    const uploaded = await upRes.json();
    const fileId = uploaded.id as string;
    let webViewLink = (uploaded.webViewLink as string | undefined) ?? null;

    // Make link-viewable.
    const permRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      },
    );
    if (!permRes.ok) {
      const t = await permRes.text();
      console.error("Drive permission set failed:", permRes.status, t);
    }

    if (!webViewLink) {
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=webViewLink`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        webViewLink = (meta.webViewLink as string | undefined) ?? null;
      }
    }

    // webViewLink opens the Drive preview; fall back to the canonical view URL.
    const viewUrl = webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
    return new Response(JSON.stringify({ success: true, fileId, viewUrl, webViewLink }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("upload-to-drive error:", e?.message ?? e);
    return new Response(JSON.stringify({ success: false, error: e?.message ?? String(e) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});