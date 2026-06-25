/* eslint-disable @typescript-eslint/no-explicit-any */
// Google Drive helper for uploading guest ID documents.
// Requires VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY to be configured.

const GOOGLE_CLIENT_ID =
  (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || "PENDING_SETUP";
const GOOGLE_API_KEY =
  (import.meta as any).env?.VITE_GOOGLE_API_KEY || "PENDING_SETUP";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const ROOT_FOLDER_NAME = "HotelPilot";

let initPromise: Promise<void> | null = null;

export function isDriveConfigured() {
  return GOOGLE_CLIENT_ID !== "PENDING_SETUP" && GOOGLE_API_KEY !== "PENDING_SETUP";
}

export async function initGoogleDrive() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (typeof window === "undefined") return;
    if (!(window as any).gapi) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://apis.google.com/js/api.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Google API script"));
        document.head.appendChild(script);
      });
    }
    await new Promise<void>((resolve) =>
      (window as any).gapi.load("client:auth2", resolve),
    );
    await (window as any).gapi.client.init({
      apiKey: GOOGLE_API_KEY,
      clientId: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      discoveryDocs: [
        "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
      ],
    });
  })();
  return initPromise;
}

export async function signInToGoogle() {
  await initGoogleDrive();
  const auth = (window as any).gapi.auth2.getAuthInstance();
  if (!auth.isSignedIn.get()) {
    await auth.signIn();
  }
}

export async function uploadToDrive(
  file: File,
  propertyName: string,
  guestName: string,
  bookingId: string,
): Promise<{ fileId: string; viewUrl: string; folderPath: string }> {
  if (!isDriveConfigured()) {
    throw new Error("Google Drive is not configured. Set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY.");
  }
  await signInToGoogle();
  const gapi = (window as any).gapi;
  const dateStr = new Date().toISOString().split("T")[0];
  const safeGuest = guestName.replace(/[^A-Za-z0-9_-]+/g, "_");
  const folderPath = `HotelPilot/${propertyName}/Guest IDs/${dateStr}/${safeGuest}_${bookingId.slice(0, 8)}`;

  async function getOrCreateFolder(name: string, parentId?: string): Promise<string> {
    const escName = name.replace(/'/g, "\\'");
    const q = parentId
      ? `name='${escName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `name='${escName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const res = await gapi.client.drive.files.list({ q, fields: "files(id)" });
    if (res.result.files.length > 0) return res.result.files[0].id;
    const meta: any = { name, mimeType: "application/vnd.google-apps.folder" };
    if (parentId) meta.parents = [parentId];
    const created = await gapi.client.drive.files.create({ resource: meta, fields: "id" });
    return created.result.id;
  }

  const rootId = await getOrCreateFolder(ROOT_FOLDER_NAME);
  const propId = await getOrCreateFolder(propertyName, rootId);
  const guestIdsId = await getOrCreateFolder("Guest IDs", propId);
  const dateId = await getOrCreateFolder(dateStr, guestIdsId);
  const guestFolderId = await getOrCreateFolder(`${safeGuest}_${bookingId.slice(0, 8)}`, dateId);

  const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
  const fileName = `${safeGuest}_ID_${dateStr}${ext}`;
  const metadata = { name: fileName, parents: [guestFolderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const token = gapi.auth.getToken().access_token;
  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
  );
  if (!uploadRes.ok) {
    const txt = await uploadRes.text();
    throw new Error(`Drive upload failed: ${uploadRes.status} ${txt}`);
  }
  const data = await uploadRes.json();
  return { fileId: data.id, viewUrl: data.webViewLink, folderPath };
}