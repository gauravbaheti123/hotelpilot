import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserCircle2 } from "lucide-react";
import { reportQueryError } from "@/lib/queryError";

export function ProfileDialog({
  open,
  onOpenChange,
  userId,
  email,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  email: string | null;
}) {
  const [name, setName] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data, error: __qe1 } = await supabase
        .from("profiles")
        .select("name, photo_url")
        .eq("id", userId)
        .maybeSingle();
      if (__qe1) reportQueryError("profiles", __qe1);
      setName((data as any)?.name ?? "");
      setPhotoUrl((data as any)?.photo_url ?? null);
      setPassword("");
    })();
  }, [open, userId]);

  async function handlePhoto(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Max 2MB image");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhotoUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    try {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ name: name.trim() || null, photo_url: photoUrl })
        .eq("id", userId);
      if (pErr) throw pErr;
      if (password) {
        if (password.length < 8) throw new Error("Password must be at least 8 characters");
        const { error: aErr } = await supabase.auth.updateUser({ password });
        if (aErr) throw aErr;
      }
      toast.success("Profile updated");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit Profile</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center overflow-hidden">
              {photoUrl ? (
                <img src={photoUrl} alt="avatar" className="h-full w-full object-cover" />
              ) : (
                <UserCircle2 className="h-10 w-10 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handlePhoto(f);
                }}
              />
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                Upload photo
              </Button>
              {photoUrl && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setPhotoUrl(null)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input value={email ?? ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">New password (optional)</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="new-password"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}