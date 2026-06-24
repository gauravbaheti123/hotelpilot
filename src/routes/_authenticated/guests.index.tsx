import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { Plus, Ban } from "lucide-react";

export const Route = createFileRoute("/_authenticated/guests/")({
  head: () => ({ meta: [{ title: "Guests — HotelPilot" }] }),
  component: GuestsListPage,
});

interface Row {
  id: string; name: string; mobile: string | null; email: string | null;
  city: string | null; tags: string[] | null; is_blacklisted: boolean;
  gst_number: string | null;
}

function GuestsListPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "blacklist" | "corporate">("all");

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("guests")
        .select("id,name,mobile,email,city,tags,is_blacklisted,gst_number")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false }).limit(500);
      setRows((data ?? []) as Row[]);
    })();
  }, [propertyId]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "blacklist" && !r.is_blacklisted) return false;
      if (filter === "corporate" && !r.gst_number) return false;
      if (!term) return true;
      return r.name.toLowerCase().includes(term) ||
        (r.mobile ?? "").includes(term) ||
        (r.email ?? "").toLowerCase().includes(term);
    });
  }, [rows, q, filter]);

  if (!propertyId) return <AppShell title="Guests"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Guests">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Input placeholder="Search name / mobile / email…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Chip label={`All (${rows.length})`} active={filter === "all"} onClick={() => setFilter("all")} />
        <Chip label="Corporate" active={filter === "corporate"} onClick={() => setFilter("corporate")} />
        <Chip label="Blacklist" active={filter === "blacklist"} onClick={() => setFilter("blacklist")} />
        <div className="ml-auto">
          <Button asChild><Link to="/guests/new"><Plus className="h-4 w-4 mr-1" />New guest</Link></Button>
        </div>
      </div>
      <Card><CardContent className="p-0 divide-y">
        {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No guests.</p>}
        {filtered.map((g) => (
          <Link key={g.id} to="/guests/$id" params={{ id: g.id }}
            className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-medium text-sm">{g.name}</div>
                {g.is_blacklisted && <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300 text-[10px]"><Ban className="h-3 w-3 mr-0.5" />Blacklist</Badge>}
                {g.gst_number && <Badge variant="outline" className="text-[10px]">GSTIN</Badge>}
                {(g.tags ?? []).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {[g.mobile, g.email, g.city].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
          </Link>
        ))}
      </CardContent></Card>
    </AppShell>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-xs border ${
      active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}>{label}</button>
  );
}