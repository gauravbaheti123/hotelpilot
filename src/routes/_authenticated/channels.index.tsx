import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { supabase } from "@/integrations/supabase/client";
import { logSync, SYNC_STATUS_LABEL, SYNC_STATUS_TONE, SYNC_TYPES, type SyncType } from "@/lib/channels";
import { toast } from "sonner";
import { Cloud, Radio, RefreshCw, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/channels/")({
  head: () => ({ meta: [{ title: "Channel Manager — HotelPilot" }] }),
  component: ChannelManagerPage,
});

interface Channel { id: string; name: string; code: string; commission_pct: number; is_active: boolean }
interface Category { id: string; name: string }
interface Tariff { id: string; name: string }
interface Mapping {
  id: string; channel_id: string; category_id: string | null; tariff_id: string | null;
  ota_room_code: string | null; ota_rate_code: string | null;
  rate_offset_pct: number; is_active: boolean;
}
interface SyncLog {
  id: string; channel_id: string | null; sync_type: string; status: string;
  message: string | null; started_at: string; finished_at: string | null;
}

function ChannelManagerPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const [ch, cat, ta, mp, lg] = await Promise.all([
      supabase.from("ota_channels").select("*").eq("property_id", propertyId).order("name"),
      supabase.from("room_categories").select("id,name").eq("property_id", propertyId).order("name"),
      supabase.from("tariff_plans").select("id,name").eq("property_id", propertyId).order("name"),
      supabase.from("ota_channel_mappings").select("*").eq("property_id", propertyId),
      supabase.from("ota_sync_logs").select("*").eq("property_id", propertyId)
        .order("started_at", { ascending: false }).limit(20),
    ]);
    setChannels((ch.data ?? []) as Channel[]);
    setCategories((cat.data ?? []) as Category[]);
    setTariffs((ta.data ?? []) as Tariff[]);
    setMappings((mp.data ?? []) as Mapping[]);
    setLogs((lg.data ?? []) as SyncLog[]);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  async function pushSync(channel: Channel, type: SyncType) {
    if (!propertyId) return;
    setSyncing(`${channel.id}-${type}`);
    // Stub: simulate push. Real implementation would call OTA APIs.
    await new Promise((r) => setTimeout(r, 600));
    const payload = { channel: channel.code, type, mappings: mappings.filter((m) => m.channel_id === channel.id).length };
    const { error } = await logSync({
      property_id: propertyId,
      channel_id: channel.id,
      sync_type: type,
      status: "success",
      message: `Pushed ${type} to ${channel.name}`,
      payload,
    });
    setSyncing(null);
    if (error) toast.error(error.message);
    else { toast.success(`${type} pushed to ${channel.name}`); load(); }
  }

  if (!propertyId) return <AppShell title="Channel Manager"><EmptyPropertyState /></AppShell>;

  const activeCount = channels.filter((c) => c.is_active).length;
  const lastSync = logs[0]?.started_at;

  return (
    <AppShell title="Channel Manager">
      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <Kpi title="Active channels" value={String(activeCount)} hint={`${channels.length} total`} icon={<Cloud className="h-4 w-4" />} />
        <Kpi title="Mappings" value={String(mappings.length)} hint="Room ↔ OTA links" icon={<Radio className="h-4 w-4" />} />
        <Kpi title="Last sync" value={lastSync ? new Date(lastSync).toLocaleString() : "Never"} hint={logs[0]?.status ? SYNC_STATUS_LABEL[logs[0].status] : ""} icon={<RefreshCw className="h-4 w-4" />} />
      </div>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Channels & quick push</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {channels.length === 0 && (
            <p className="text-sm text-muted-foreground">No channels yet. Add them under Master Data → OTA Channels.</p>
          )}
          {channels.map((c) => {
            const mc = mappings.filter((m) => m.channel_id === c.id);
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 rounded border p-3">
                <div className="flex-1 min-w-[180px]">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.code} · {Number(c.commission_pct).toFixed(1)}% commission · {mc.length} mappings
                  </div>
                </div>
                <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Off"}</Badge>
                <div className="flex flex-wrap gap-2">
                  {SYNC_TYPES.map((t) => (
                    <Button
                      key={t}
                      size="sm"
                      variant="outline"
                      disabled={!c.is_active || syncing === `${c.id}-${t}`}
                      onClick={() => pushSync(c, t)}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncing === `${c.id}-${t}` ? "animate-spin" : ""}`} />
                      Push {t}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Room ↔ Channel mappings</CardTitle>
          <MappingDialog
            propertyId={propertyId}
            channels={channels} categories={categories} tariffs={tariffs}
            onSaved={load}
          />
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Room category</th>
                <th className="px-3 py-2">Tariff</th>
                <th className="px-3 py-2">OTA room</th>
                <th className="px-3 py-2">OTA rate</th>
                <th className="px-3 py-2 text-right">Rate Δ%</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2">{channels.find((c) => c.id === m.channel_id)?.name ?? "—"}</td>
                  <td className="px-3 py-2">{categories.find((c) => c.id === m.category_id)?.name ?? "—"}</td>
                  <td className="px-3 py-2">{tariffs.find((t) => t.id === m.tariff_id)?.name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{m.ota_room_code ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{m.ota_rate_code ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{Number(m.rate_offset_pct).toFixed(1)}%</td>
                  <td className="px-3 py-2">
                    <Badge variant={m.is_active ? "default" : "secondary"}>{m.is_active ? "Active" : "Off"}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Button size="icon" variant="ghost" onClick={async () => {
                      await supabase.from("ota_channel_mappings").delete().eq("id", m.id);
                      load();
                    }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {mappings.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No mappings yet</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent sync activity</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(l.started_at).toLocaleString()}</td>
                  <td className="px-3 py-2">{channels.find((c) => c.id === l.channel_id)?.name ?? "—"}</td>
                  <td className="px-3 py-2 capitalize">{l.sync_type}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${SYNC_STATUS_TONE[l.status] ?? ""}`}>
                      {SYNC_STATUS_LABEL[l.status] ?? l.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{l.message ?? "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No sync activity yet</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Kpi({ title, value, hint, icon }: { title: string; value: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function MappingDialog({ propertyId, channels, categories, tariffs, onSaved }: {
  propertyId: string;
  channels: Channel[]; categories: Category[]; tariffs: Tariff[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tariffId, setTariffId] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [rateCode, setRateCode] = useState("");
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!channelId) { toast.error("Pick a channel"); return; }
    setSaving(true);
    const { error } = await supabase.from("ota_channel_mappings").insert({
      property_id: propertyId,
      channel_id: channelId,
      category_id: categoryId || null,
      tariff_id: tariffId || null,
      ota_room_code: roomCode || null,
      ota_rate_code: rateCode || null,
      rate_offset_pct: offset,
      is_active: active,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Mapping added");
    setOpen(false);
    setChannelId(""); setCategoryId(""); setTariffId(""); setRoomCode(""); setRateCode(""); setOffset(0); setActive(true);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={channels.length === 0}><Plus className="h-4 w-4 mr-1" /> Add mapping</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New room ↔ channel mapping</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div>
            <Label>Channel</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger><SelectValue placeholder="Select channel" /></SelectTrigger>
              <SelectContent>
                {channels.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Room category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tariff</Label>
              <Select value={tariffId} onValueChange={setTariffId}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {tariffs.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>OTA room code</Label>
              <Input value={roomCode} onChange={(e) => setRoomCode(e.target.value)} placeholder="e.g. STD-DBL" />
            </div>
            <div>
              <Label>OTA rate code</Label>
              <Input value={rateCode} onChange={(e) => setRateCode(e.target.value)} placeholder="e.g. BAR" />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 items-end">
            <div>
              <Label>Rate offset %</Label>
              <Input type="number" value={offset} onChange={(e) => setOffset(Number(e.target.value))} />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={active} onCheckedChange={setActive} id="active" />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}