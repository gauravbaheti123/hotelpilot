import { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, Printer, FileCode2 } from "lucide-react";

interface Props {
  title: string;
  filters: ReactNode;
  children: ReactNode;
  onExcel?: () => void;
  onPdf?: () => void;
  onTally?: () => void;
  tallyLabel?: string;
  disabled?: boolean;
  description?: string;
  hideExports?: boolean;
}

export function ReportShell({
  title, filters, children, onExcel, onPdf, onTally, tallyLabel, disabled, description, hideExports,
}: Props) {
  return (
    <AppShell title={title}>
      <div className="space-y-4 print:space-y-2">
        <Card className="report-filters print:hidden">
          <CardContent className="pt-6 flex flex-wrap items-end gap-3">
            {filters}
            {!hideExports && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {onExcel && (
                  <Button size="sm" variant="outline" onClick={onExcel} disabled={disabled}>
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> Export Excel
                  </Button>
                )}
                {onPdf && (
                  <Button size="sm" variant="outline" onClick={onPdf} disabled={disabled}>
                    <Printer className="h-4 w-4 mr-1" /> Export PDF
                  </Button>
                )}
                {onTally && (
                  <Button size="sm" variant="outline" onClick={onTally} disabled={disabled}>
                    <FileCode2 className="h-4 w-4 mr-1" /> {tallyLabel ?? "Export for Tally"}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        {description && <p className="text-xs text-muted-foreground print:hidden">{description}</p>}
        {children}
      </div>
    </AppShell>
  );
}

// Suppress unused-import warning
void Download;