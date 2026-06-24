import { Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function EmptyPropertyState() {
  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6 text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Building2 className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold">No property selected</h3>
          <p className="text-sm text-muted-foreground">
            Create a property first, then come back here to set up master data.
          </p>
        </div>
        <Button asChild>
          <Link to="/properties">Go to Properties</Link>
        </Button>
      </CardContent>
    </Card>
  );
}