import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Eye, EyeOff, Wifi, MessageCircle, ShieldCheck } from "lucide-react";
import { testAiSensy } from "@/lib/whatsapp";

export const Route = createFileRoute("/_authenticated/settings/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp Settings — HotelPilot" }] }),
  component: WhatsAppSettingsPage,
});

function WhatsAppSettingsPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [apiKey, setApiKey] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    supabase.rpc("get_property_secrets", { _property_id: propertyId })
      .then(({ data, error }) => {
        if (error) {
          toast.error(error.message);
          setLoaded(true);
          return;
        }
        const row = Array.isArray(data) ? data[0] : data;
        setApiKey(row?.aisensy_api_key ?? "");
        setWaNumber(row?.wa_number ?? "");
        setWifiPassword(row?.wifi_password ?? "");
        setLoaded(true);
      });
  }, [propertyId]);

  async function save() {
    if (!propertyId) return;
    setSaving(true);
    const { error } = await supabase.rpc("save_property_secrets", {
      _property_id: propertyId,
      _aisensy_api_key: apiKey,
      _wa_number: waNumber,
      _wifi_password: wifiPassword,
    });
    setSaving(false);
    if (error) toast.error(error.message); else toast.success("WhatsApp settings saved");
  }

  async function test() {
    if (!propertyId) return;
    setTesting(true);
    const { data, error } = await testAiSensy(propertyId);
    setTesting(false);
    if (error) toast.error(error.message);
    else if (data?.ok) toast.success("Edge function reachable ✓");
    else toast.error(data?.error ?? "Test failed");
  }

  if (!propertyId) return <AppShell title="WhatsApp Settings"><EmptyPropertyState /></AppShell>;

  const webhookUrl = `https://fjhvpzpahlcezcbksnpr.supabase.co/functions/v1/aisensy-webhook`;

  return (
    <AppShell title="WhatsApp Settings">
      <div className="max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" /> AiSensy WhatsApp configuration</CardTitle>
            <CardDescription>
              Configure WhatsApp Business automation for this property. The API key is used by the server only — it is never sent to other guests.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="key">AiSensy API key</Label>
              <div className="flex gap-2 mt-1">
                <Input id="key" type={showKey ? "text" : "password"}
                  value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder="aisensy-xxxxxxxxxxxxxxxx" autoComplete="off" />
                <Button variant="outline" size="icon" onClick={() => setShowKey((s) => !s)} aria-label="Toggle key visibility">
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Get from AiSensy → Settings → API Key.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="wa">WhatsApp Business number</Label>
                <Input id="wa" value={waNumber} onChange={(e) => setWaNumber(e.target.value)} placeholder="919812345678" />
                <p className="text-xs text-muted-foreground mt-1">Country code + number, digits only.</p>
              </div>
              <div>
                <Label htmlFor="wifi"><Wifi className="inline h-3.5 w-3.5 mr-1" />Wi-Fi password (used in templates)</Label>
                <Input id="wifi" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} placeholder="Guest123" />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={save} disabled={saving || !loaded}>{saving ? "Saving…" : "Save settings"}</Button>
              <Button variant="outline" onClick={test} disabled={testing || !loaded}>
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <Badge variant={apiKey ? "default" : "secondary"} className="ml-auto self-center">
                {apiKey ? "Configured" : "Not configured"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Inbound webhook</CardTitle>
            <CardDescription>Paste this URL into AiSensy → Webhooks → "Incoming messages" so guest replies appear in the inbox.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("Copied"); }}>Copy</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}