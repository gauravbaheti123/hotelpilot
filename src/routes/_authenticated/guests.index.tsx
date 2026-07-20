import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { Plus, Ban, Eye, Pencil, Trash2, Download, Upload, FileDown } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { logActivity, userDisplayName } from "@/lib/activityLog";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/guests/")({
  head: () => ({ meta: [{ title: "Guests — HotelPilot" }] }),
  component: () => (<RequirePermission module="guest_crm"><GuestsListPage /></RequirePermission>),
});

interface Row {
  id: string; name: string; mobile: string | null; email: string | null;
  city: string | null; tags: string[] | null; is_blacklisted: boolean;
  gst_number: string | null; company: string | null;
}

const EXPORT_COLUMNS = [
  "Name","Mobile","Email","Company Name","GST Number","ID Proof Type","ID Proof Number",
  "Address","Guest Type","Visit Count","Last Stay","Notes",
] as const;

const SAMPLE_CSV = [
  EXPORT_COLUMNS.join(","),
  ["John Doe","9876543210","john@example.com","Growth Story Pvt Ltd","29ABCDE1234F1Z5","aadhaar","1234-5678-9012",
   "Mumbai","regular","","",""].join(","),
].join("\n");

const GUEST_FETCH_LIMIT = 15500;
const GUEST_PAGE_SIZE = 1000;

async function fetchGuestsPaginated<T>(
  propertyId: string,
  select: string,
  orderColumn: string,
  ascending: boolean,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < GUEST_FETCH_LIMIT; from += GUEST_PAGE_SIZE) {
    const to = Math.min(from + GUEST_PAGE_SIZE, GUEST_FETCH_LIMIT) - 1;
    const { data, error } = await supabase.from("guests")
      .select(select)
      .eq("property_id", propertyId)
      .order(orderColumn, { ascending })
      .range(from, to);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    all.push(...batch);
    if (batch.length < to - from + 1) break;
  }
  return all;
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function downloadFile(name: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function GuestsListPage() {
  const { currentId: propertyId, current } = useCurrentProperty();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "blacklist" | "corporate">("all");
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Array<Record<string, string>>>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: number; skipped: number; errors: string[] } | null>(null);
  const [dedupeMode, setDedupeMode] = useState<"skip" | "update">("skip");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!propertyId) return;
    try {
      const data = await fetchGuestsPaginated<Row>(
        propertyId,
        "id,name,mobile,email,city,tags,is_blacklisted,gst_number,company",
        "created_at",
        false,
      );
      setRows(data);
      setSelected(new Set());
    } catch (error: any) {
      toast.error(error?.message ?? "Could not load guests");
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [propertyId]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const { error } = await supabase.from("guests").delete().eq("id", toDelete.id);
    setDeleting(false);
    if (error) { toast.error(error.message); return; }
    if (propertyId) {
      const { data: u } = await supabase.auth.getUser();
      logActivity({
        property_id: propertyId,
        user_id: u.user?.id ?? "",
        user_name: userDisplayName(u.user as never),
        action_type: "GUEST_DELETED",
        module: "Guests",
        reference_id: toDelete.id,
        reference_label: toDelete.name,
        details: { guest_id: toDelete.id, guest_name: toDelete.name },
      });
    }
    toast.success("Guest deleted");
    setToDelete(null);
    load();
  }

  async function confirmBulkDelete() {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const removed = rows.filter((r) => selected.has(r.id));
    const { error } = await supabase.from("guests").delete().in("id", ids);
    setBulkBusy(false);
    setBulkOpen(false);
    if (error) return toast.error(error.message);
    if (propertyId) {
      const { data: u } = await supabase.auth.getUser();
      for (const r of removed) {
        logActivity({
          property_id: propertyId,
          user_id: u.user?.id ?? "",
          user_name: userDisplayName(u.user as never),
          action_type: "GUEST_DELETED",
          module: "Guests",
          reference_id: r.id,
          reference_label: r.name,
          details: { guest_id: r.id, guest_name: r.name },
        });
      }
    }
    toast.success(`${ids.length} guests deleted`);
    load();
  }

  async function exportCsv() {
    if (!propertyId) return;
    let data: any[] = [];
    try {
      data = await fetchGuestsPaginated<any>(
        propertyId,
        "name,mobile,email,company,gst_number,id_proof_type,id_proof_number,address,tags,visit_count,notes,created_at",
        "name",
        true,
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Could not export guests");
      return;
    }
    const ids = (data ?? []).map((g: any) => g.id).filter(Boolean);
    void ids;
    const lines = [EXPORT_COLUMNS.join(",")];
    for (const g of (data ?? []) as any[]) {
      const guestType = Array.isArray(g.tags) && g.tags.length ? String(g.tags[0]) : "regular";
      lines.push([
        csvEscape(g.name), csvEscape(g.mobile), csvEscape(g.email),
        csvEscape(g.company), csvEscape(g.gst_number),
        csvEscape(g.id_proof_type), csvEscape(g.id_proof_number),
        csvEscape(g.address), csvEscape(guestType),
        csvEscape(g.visit_count ?? 0), csvEscape(""), csvEscape(g.notes),
      ].join(","));
    }
    const hotel = (current?.name ?? "hotel").replace(/\s+/g, "-").toLowerCase();
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`guests-${hotel}-${date}.csv`, lines.join("\n"));
  }

  function downloadSample() {
    downloadFile("guests-sample.csv", SAMPLE_CSV);
  }

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const grid = parseCsv(text);
      if (grid.length < 2) { toast.error("CSV is empty"); return; }
      const header = grid[0].map((h) => h.trim());
      const out: Array<Record<string, string>> = [];
      for (let i = 1; i < grid.length; i++) {
        const obj: Record<string, string> = {};
        header.forEach((h, idx) => { obj[h] = (grid[i][idx] ?? "").trim(); });
        out.push(obj);
      }
      setImportRows(out);
      setImportResult(null);
    };
    reader.readAsText(f);
  }

  async function runImport() {
    if (!propertyId || importRows.length === 0) return;
    setImportBusy(true);
    const errors: string[] = [];
    let ok = 0, skipped = 0;
    // Pre-fetch existing mobiles
    const { data: existing } = await supabase.from("guests")
      .select("id,mobile").eq("property_id", propertyId);
    const byMobile = new Map<string, string>();
    (existing ?? []).forEach((g: any) => { if (g.mobile) byMobile.set(String(g.mobile).trim(), g.id); });

    for (let i = 0; i < importRows.length; i++) {
      const r = importRows[i];
      const name = (r["Name"] ?? "").trim();
      const mobile = (r["Mobile"] ?? "").trim();
      if (!name) { errors.push(`Row ${i + 2}: name required`); continue; }
      if (!/^\d{10}$/.test(mobile.replace(/\D/g, "").slice(-10))) {
        errors.push(`Row ${i + 2}: mobile must be 10 digits`); continue;
      }
      const guestType = (r["Guest Type"] ?? "regular").trim().toLowerCase();
      const payload: any = {
        property_id: propertyId,
        name,
        mobile,
        email: r["Email"]?.trim() || null,
        company: r["Company Name"]?.trim() || r["Company"]?.trim() || null,
        gst_number: r["GST Number"]?.trim() || r["GSTIN"]?.trim() || null,
        id_proof_type: r["ID Proof Type"]?.trim() || null,
        id_proof_number: r["ID Proof Number"]?.trim() || null,
        address: r["Address"]?.trim() || null,
        notes: r["Notes"]?.trim() || null,
        tags: guestType && guestType !== "regular" ? [guestType] : [],
      };
      const exId = byMobile.get(mobile);
      if (exId) {
        if (dedupeMode === "skip") { skipped++; continue; }
        const { error } = await supabase.from("guests").update(payload).eq("id", exId);
        if (error) errors.push(`Row ${i + 2}: ${error.message}`); else ok++;
      } else {
        const { error } = await supabase.from("guests").insert(payload);
        if (error) errors.push(`Row ${i + 2}: ${error.message}`); else ok++;
      }
    }
    setImportResult({ ok, skipped, errors });
    setImportBusy(false);
    if (ok > 0) load();
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "blacklist" && !r.is_blacklisted) return false;
      if (filter === "corporate" && !r.gst_number) return false;
      if (!term) return true;
      return r.name.toLowerCase().includes(term) ||
        (r.mobile ?? "").includes(term) ||
        (r.email ?? "").toLowerCase().includes(term) ||
        (r.company ?? "").toLowerCase().includes(term);
    });
  }, [rows, q, filter]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }
  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  if (!propertyId) return <AppShell title="Guests"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Guests">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Input placeholder="Search name / mobile / email / company…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Chip label={`All (${rows.length})`} active={filter === "all"} onClick={() => setFilter("all")} />
        <Chip label="Corporate" active={filter === "corporate"} onClick={() => setFilter("corporate")} />
        <Chip label="Blacklist" active={filter === "blacklist"} onClick={() => setFilter("blacklist")} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <Button size="sm" variant="destructive" onClick={() => setBulkOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />Delete selected ({selected.size})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setImportOpen(true); setImportRows([]); setImportResult(null); }}>
            <Upload className="h-4 w-4 mr-1" />Import
          </Button>
          <Button asChild><Link to="/guests/new"><Plus className="h-4 w-4 mr-1" />New guest</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0 divide-y">
        {filtered.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-muted/40 text-xs">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
            <span className="text-muted-foreground">Select all on this view</span>
          </div>
        )}
        {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No guests.</p>}
        {filtered.map((g) => (
          <div key={g.id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
            <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggleOne(g.id)}
              aria-label={`Select ${g.name}`} onClick={(e) => e.stopPropagation()} />
            <Link to="/guests/$id" params={{ id: g.id }} className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm">{g.name}</div>
                {g.is_blacklisted && <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300 text-[10px]"><Ban className="h-3 w-3 mr-0.5" />Blacklist</Badge>}
                {g.gst_number && <Badge variant="outline" className="text-[10px]">GSTIN</Badge>}
                {(g.tags ?? []).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {[g.company, g.mobile, g.email, g.city].filter(Boolean).join(" · ") || "—"}
              </div>
            </Link>
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="ghost" title="View"
                onClick={() => router.navigate({ to: "/guests/$id", params: { id: g.id } })}>
                <Eye className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" title="Edit"
                onClick={() => router.navigate({ to: "/guests/$id", params: { id: g.id } })}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" title="Delete"
                className="text-rose-600 hover:text-rose-700"
                onClick={() => setToDelete(g)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent></Card>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete guest?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium">{toDelete?.name}</span> and cannot be undone.
              Bookings linked to this guest will lose the guest reference.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}
              className="bg-rose-600 hover:bg-rose-700">
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} guests?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Booking history will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkDelete} disabled={bulkBusy} className="bg-rose-600 hover:bg-rose-700">
              {bulkBusy ? "Deleting…" : `Delete ${selected.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import guests from CSV</DialogTitle>
            <DialogDescription>
              Required columns: Name, Mobile. Other columns optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={downloadSample}>
                <FileDown className="h-4 w-4 mr-1" />Download Sample CSV
              </Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFilePick} />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" />Choose CSV
              </Button>
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span>On duplicate mobile:</span>
                <select className="border rounded px-2 py-1 text-xs"
                  value={dedupeMode} onChange={(e) => setDedupeMode(e.target.value as any)}>
                  <option value="skip">Skip</option>
                  <option value="update">Update existing</option>
                </select>
              </div>
            </div>

            {importRows.length > 0 && (
              <div className="border rounded max-h-80 overflow-auto text-xs">
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>{EXPORT_COLUMNS.map((c) => <th key={c} className="px-2 py-1 text-left">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {importRows.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t">
                        {EXPORT_COLUMNS.map((c) => <td key={c} className="px-2 py-1">{r[c] ?? ""}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importRows.length > 50 && (
                  <div className="px-2 py-1 text-muted-foreground">+ {importRows.length - 50} more rows…</div>
                )}
              </div>
            )}

            {importResult && (
              <div className="text-sm space-y-1">
                <div>✅ {importResult.ok} imported · ⏭ {importResult.skipped} skipped · ❗ {importResult.errors.length} errors</div>
                {importResult.errors.length > 0 && (
                  <Button size="sm" variant="outline"
                    onClick={() => downloadFile("import-errors.txt", importResult.errors.join("\n"), "text/plain")}>
                    Download error details
                  </Button>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Close</Button>
            <Button onClick={runImport} disabled={importBusy || importRows.length === 0}>
              {importBusy ? "Importing…" : `Import ${importRows.length} rows`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-xs border ${
      active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}>{label}</button>
  );
}