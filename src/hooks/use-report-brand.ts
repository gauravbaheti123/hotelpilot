import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resolveLogoUrl } from "@/lib/invoiceTemplates";
import type { ReportBrand } from "@/lib/reportExports";

/**
 * Property letterhead (name, address, phone, GSTIN, logo) for branded report
 * exports. Shared by every report so PDF headers stay identical to invoices.
 */
export function useReportBrand(propertyId: string | null | undefined): ReportBrand {
  const [brand, setBrand] = useState<ReportBrand>({ name: "" });

  useEffect(() => {
    if (!propertyId) { setBrand({ name: "" }); return; }
    let cancel = false;
    (async () => {
      const { data: p } = await supabase.from("properties")
        .select("name,gstin,address_line1,address_line2,city,state,pin_code,phone,logo_url")
        .eq("id", propertyId).maybeSingle();
      if (!p || cancel) return;
      const logo = await resolveLogoUrl(p.logo_url);
      if (cancel) return;
      setBrand({
        name: p.name,
        gstin: p.gstin,
        phone: p.phone,
        address: [p.address_line1, p.address_line2, [p.city, p.pin_code].filter(Boolean).join(" "), p.state]
          .filter(Boolean).join(", "),
        logoDataUrl: logo,
      });
    })();
    return () => { cancel = true; };
  }, [propertyId]);

  return brand;
}
