import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalContact } from "@/components/LegalPage";

export const Route = createFileRoute("/sla")({
  head: () => ({
    meta: [
      { title: "Service Level Agreement | HotelPilot" },
      { name: "description", content: "HotelPilot Service Level Agreement (SLA): availability commitments, maintenance windows, support hours, and issue severity targets." },
      { property: "og:title", content: "Service Level Agreement | HotelPilot" },
      { property: "og:description", content: "HotelPilot SLA and support commitments." },
    ],
  }),
  component: Sla,
});

function Sla() {
  return (
    <LegalPage title="Service Level Agreement">
      <LegalSection title="1. Purpose">
        <p>This Service Level Agreement ("SLA") describes the level of service the Property can expect from Growth Story Company in relation to HotelPilot.in, and the support process for reporting issues.</p>
      </LegalSection>
      <LegalSection title="2. Service Availability Commitment">
        <p>The Company will use commercially reasonable efforts to maintain Service availability on a best-effort basis. As the Service and its supporting infrastructure continue to mature, a formal numerical uptime guarantee (e.g. 99.5%) will be published once sufficient operational history is established. Until then, the Company targets high availability consistent with industry best practices for cloud-hosted SaaS applications.</p>
      </LegalSection>
      <LegalSection title="3. Scheduled Maintenance">
        <ul className="list-disc pl-6 space-y-2">
          <li>The Company may perform scheduled maintenance for updates, improvements, or security patches.</li>
          <li>Where feasible, scheduled maintenance affecting availability will be communicated to Properties at least 24 hours in advance via email or in-app notice.</li>
          <li>Emergency maintenance required to address critical security issues may be performed without prior notice.</li>
        </ul>
      </LegalSection>
      <LegalSection title="4. Support Channels & Hours">
        <ul className="list-disc pl-6 space-y-2">
          <li>Support Phone: <a className="text-teal-700 hover:underline" href="tel:8007444464">8007444464</a></li>
          <li>Support Email: <a className="text-teal-700 hover:underline" href="mailto:Consult@Growthstoryco.in">Consult@Growthstoryco.in</a></li>
          <li>Standard support hours: 9:00 AM to 9:00 PM IST, all days, unless otherwise communicated.</li>
        </ul>
      </LegalSection>
      <LegalSection title="5. Issue Severity & Response Targets">
        <p>Issues reported by Properties are handled based on severity, on a best-effort basis:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Critical</strong> (Service down, unable to check-in/bill guests): Acknowledged and worked on as top priority, typically within a few hours.</li>
          <li><strong>High</strong> (Major feature not working, e.g. billing or KOT malfunction): Acknowledged within 1 business day.</li>
          <li><strong>Medium</strong> (Minor feature issue, non-blocking): Acknowledged within 2-3 business days.</li>
          <li><strong>Low</strong> (Cosmetic issues, feature requests): Reviewed and scheduled in upcoming updates.</li>
        </ul>
      </LegalSection>
      <LegalSection title="6. Data Backup">
        <p>The Company maintains regular backups of Property data as part of standard database operations on its cloud infrastructure provider, to support recovery in case of technical failure. Properties are encouraged to periodically export critical reports for their own records.</p>
      </LegalSection>
      <LegalSection title="7. Exclusions">
        <p>This SLA does not cover downtime or issues caused by: internet connectivity or hardware issues on the Property's end, third-party service outages (e.g. OTA/channel partners, SMS/WhatsApp gateways), force majeure events, or misuse of the Service by the Property's staff.</p>
      </LegalSection>
      <LegalSection title="8. Escalation">
        <p>If a support issue is not resolved satisfactorily through standard channels, it may be escalated directly via email to <a className="text-teal-700 hover:underline" href="mailto:Consult@Growthstoryco.in">Consult@Growthstoryco.in</a> marked "Escalation" in the subject line.</p>
      </LegalSection>
      <LegalSection title="9. Changes to this SLA">
        <p>As the platform matures, this SLA — including formal uptime commitments — may be revised and communicated to Properties in advance.</p>
      </LegalSection>
      <LegalContact />
    </LegalPage>
  );
}