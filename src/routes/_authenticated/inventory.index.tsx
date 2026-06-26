import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Boxes, ArrowLeftRight, Package, Truck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inventory/")({
  head: () => ({ meta: [{ title: "Inventory — HotelPilot" }] }),
  component: InventoryIndex,
});

const ITEMS = [
  { to: "/inventory/stock", label: "Current Stock", icon: Boxes, desc: "Live stock levels" },
  { to: "/inventory/movements", label: "Stock Movements", icon: ArrowLeftRight, desc: "In/out history" },
  { to: "/inventory/items", label: "Items", icon: Package, desc: "Manage SKUs" },
  { to: "/inventory/vendors", label: "Vendors", icon: Truck, desc: "Supplier directory" },
];

function InventoryIndex() {
  return (
    <AppShell title="Inventory">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {ITEMS.map((it) => (
          <Link key={it.to} to={it.to}>
            <Card className="hover:shadow-md hover:border-primary/40 transition-all h-full">
              <CardContent className="p-5 flex items-start gap-3">
                <div className="p-2 rounded-md bg-primary/10 text-primary"><it.icon className="h-5 w-5" /></div>
                <div>
                  <div className="font-medium">{it.label}</div>
                  <div className="text-xs text-muted-foreground">{it.desc}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}