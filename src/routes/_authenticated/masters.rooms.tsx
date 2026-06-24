import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/masters/rooms")({
  head: () => ({ meta: [{ title: "Rooms & Categories — HotelPilot" }] }),
  component: RoomsMasterPage,
});

interface Category {
  id: string;
  name: string;
  code: string | null;
  base_rate: number;
  max_occupancy: number;
  extra_bed_rate: number;
  is_active: boolean;
}
interface Room {
  id: string;
  room_number: string;
  floor: string | null;
  category_id: string | null;
  status: string;
  housekeeping_status: string;
  is_active: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  vacant: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  occupied: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  blocked: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  maintenance: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

function RoomsMasterPage() {
  const { roles } = useAuth();
  const canManage =
    roles.includes("superadmin") || roles.includes("owner") || roles.includes("manager");
  const { current, loading: propLoading } = useCurrentProperty();
  const [cats, setCats] = useState<Category[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  const [catOpen, setCatOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Partial<Category> | null>(null);
  const [roomOpen, setRoomOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Partial<Room> | null>(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    const [c, r] = await Promise.all([
      supabase
        .from("room_categories")
        .select("*")
        .eq("property_id", current.id)
        .order("name"),
      supabase
        .from("rooms")
        .select("*")
        .eq("property_id", current.id)
        .order("room_number"),
    ]);
    if (c.error) toast.error(c.error.message);
    if (r.error) toast.error(r.error.message);
    setCats((c.data ?? []) as Category[]);
    setRooms((r.data ?? []) as Room[]);
    setLoading(false);
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  async function saveCat() {
    if (!editingCat?.name || !current) return toast.error("Name required");
    const payload = {
      property_id: current.id,
      name: editingCat.name,
      code: editingCat.code ?? null,
      base_rate: Number(editingCat.base_rate ?? 0),
      max_occupancy: Number(editingCat.max_occupancy ?? 2),
      extra_bed_rate: Number(editingCat.extra_bed_rate ?? 0),
      is_active: editingCat.is_active ?? true,
    };
    const { error } = editingCat.id
      ? await supabase.from("room_categories").update(payload).eq("id", editingCat.id)
      : await supabase.from("room_categories").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setCatOpen(false);
    setEditingCat(null);
    load();
  }

  async function saveRoom() {
    if (!editingRoom?.room_number || !current) return toast.error("Room number required");
    const payload = {
      property_id: current.id,
      room_number: editingRoom.room_number,
      floor: editingRoom.floor ?? null,
      category_id: editingRoom.category_id ?? null,
      status: editingRoom.status ?? "vacant",
      housekeeping_status: editingRoom.housekeeping_status ?? "clean",
      is_active: editingRoom.is_active ?? true,
    };
    const { error } = editingRoom.id
      ? await supabase.from("rooms").update(payload).eq("id", editingRoom.id)
      : await supabase.from("rooms").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setRoomOpen(false);
    setEditingRoom(null);
    load();
  }

  async function removeCat(c: Category) {
    if (!confirm(`Delete category "${c.name}"?`)) return;
    const { error } = await supabase.from("room_categories").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    load();
  }
  async function removeRoom(r: Room) {
    if (!confirm(`Delete room ${r.room_number}?`)) return;
    const { error } = await supabase.from("rooms").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    load();
  }

  if (propLoading) {
    return (
      <AppShell title="Rooms & Categories">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  }
  if (!current) {
    return (
      <AppShell title="Rooms & Categories">
        <EmptyPropertyState />
      </AppShell>
    );
  }

  return (
    <AppShell title="Rooms & Categories">
      <div className="max-w-6xl space-y-6">
        {/* CATEGORIES */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Room categories</CardTitle>
            {canManage && (
              <Dialog open={catOpen} onOpenChange={setCatOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditingCat({
                        name: "",
                        base_rate: 0,
                        max_occupancy: 2,
                        extra_bed_rate: 0,
                        is_active: true,
                      })
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" /> Category
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {editingCat?.id ? "Edit category" : "New category"}
                    </DialogTitle>
                  </DialogHeader>
                  {editingCat && (
                    <div className="grid grid-cols-2 gap-3">
                      <Box label="Name *">
                        <Input
                          value={editingCat.name ?? ""}
                          onChange={(e) =>
                            setEditingCat({ ...editingCat, name: e.target.value })
                          }
                        />
                      </Box>
                      <Box label="Code">
                        <Input
                          value={editingCat.code ?? ""}
                          onChange={(e) =>
                            setEditingCat({ ...editingCat, code: e.target.value })
                          }
                        />
                      </Box>
                      <Box label="Base rate (₹)">
                        <Input
                          type="number"
                          value={editingCat.base_rate ?? 0}
                          onChange={(e) =>
                            setEditingCat({
                              ...editingCat,
                              base_rate: Number(e.target.value),
                            })
                          }
                        />
                      </Box>
                      <Box label="Max occupancy">
                        <Input
                          type="number"
                          value={editingCat.max_occupancy ?? 2}
                          onChange={(e) =>
                            setEditingCat({
                              ...editingCat,
                              max_occupancy: Number(e.target.value),
                            })
                          }
                        />
                      </Box>
                      <Box label="Extra bed rate (₹)">
                        <Input
                          type="number"
                          value={editingCat.extra_bed_rate ?? 0}
                          onChange={(e) =>
                            setEditingCat({
                              ...editingCat,
                              extra_bed_rate: Number(e.target.value),
                            })
                          }
                        />
                      </Box>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCatOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={saveCat}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : cats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No categories yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Base rate</TableHead>
                    <TableHead>Max occ.</TableHead>
                    <TableHead>Extra bed</TableHead>
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cats.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>{c.code ?? "—"}</TableCell>
                      <TableCell>₹{c.base_rate}</TableCell>
                      <TableCell>{c.max_occupancy}</TableCell>
                      <TableCell>₹{c.extra_bed_rate}</TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingCat(c);
                              setCatOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => removeCat(c)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ROOMS */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Rooms</CardTitle>
            {canManage && (
              <Dialog open={roomOpen} onOpenChange={setRoomOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    disabled={cats.length === 0}
                    onClick={() =>
                      setEditingRoom({
                        room_number: "",
                        floor: "",
                        category_id: cats[0]?.id,
                        status: "vacant",
                        housekeeping_status: "clean",
                        is_active: true,
                      })
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" /> Room
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {editingRoom?.id ? "Edit room" : "New room"}
                    </DialogTitle>
                  </DialogHeader>
                  {editingRoom && (
                    <div className="grid grid-cols-2 gap-3">
                      <Box label="Room number *">
                        <Input
                          value={editingRoom.room_number ?? ""}
                          onChange={(e) =>
                            setEditingRoom({
                              ...editingRoom,
                              room_number: e.target.value,
                            })
                          }
                        />
                      </Box>
                      <Box label="Floor">
                        <Input
                          value={editingRoom.floor ?? ""}
                          onChange={(e) =>
                            setEditingRoom({ ...editingRoom, floor: e.target.value })
                          }
                        />
                      </Box>
                      <Box label="Category">
                        <Select
                          value={editingRoom.category_id ?? ""}
                          onValueChange={(v) =>
                            setEditingRoom({ ...editingRoom, category_id: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {cats.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Box>
                      <Box label="Status">
                        <Select
                          value={editingRoom.status ?? "vacant"}
                          onValueChange={(v) =>
                            setEditingRoom({ ...editingRoom, status: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["vacant", "occupied", "blocked", "maintenance"].map(
                              (s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </Box>
                      <Box label="Housekeeping">
                        <Select
                          value={editingRoom.housekeeping_status ?? "clean"}
                          onValueChange={(v) =>
                            setEditingRoom({
                              ...editingRoom,
                              housekeeping_status: v,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["clean", "dirty", "inspected", "out_of_order"].map(
                              (s) => (
                                <SelectItem key={s} value={s}>
                                  {s.replace("_", " ")}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </Box>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setRoomOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={saveRoom}>Save</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {cats.length === 0
                  ? "Add a category first, then create rooms."
                  : "No rooms yet."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room #</TableHead>
                    <TableHead>Floor</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>HK</TableHead>
                    {canManage && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rooms.map((r) => {
                    const cat = cats.find((c) => c.id === r.category_id);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.room_number}</TableCell>
                        <TableCell>{r.floor ?? "—"}</TableCell>
                        <TableCell>{cat?.name ?? "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={STATUS_COLORS[r.status] ?? ""}
                          >
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.housekeeping_status.replace("_", " ")}
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditingRoom(r);
                                setRoomOpen(true);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive"
                              onClick={() => removeRoom(r)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}