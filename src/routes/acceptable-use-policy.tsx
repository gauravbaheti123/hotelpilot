import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalContact } from "@/components/LegalPage";

export const Route = createFileRoute("/acceptable-use-policy")({
  head: () => ({
    meta: [
      { title: "Acceptable Use Policy | HotelPilot" },
      { name: "description", content: "Rules for acceptable use of HotelPilot.in by Properties and their staff." },
      { property: "og:title", content: "Acceptable Use Policy | HotelPilot" },
      { property: "og:description", content: "HotelPilot acceptable use rules." },
    ],
  }),
  component: Aup,
});

function Aup() {
  return (
    <LegalPage title="Acceptable Use Policy">
      <LegalSection title="1. Purpose">
        <p>This Acceptable Use Policy ("AUP") sets out the rules for acceptable use of HotelPilot.in (the "Service") by Properties and their staff. It forms part of, and should be read together with, our Terms of Service.</p>
      </LegalSection>
      <LegalSection title="2. Permitted Use">
        <p>The Service is provided solely for lawful hotel and hospitality property management purposes, including front desk operations, billing, housekeeping, food & kitchen order management, banquet/event management, reporting, and related administrative functions by authorized Property staff.</p>
      </LegalSection>
      <LegalSection title="3. Prohibited Activities">
        <p>Users of the Service must not:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Attempt to access data, accounts, or properties they are not authorized to access, including attempting to bypass multi-property data isolation.</li>
          <li>Share login credentials with unauthorized individuals, or allow account access by anyone outside the Property's authorized staff.</li>
          <li>Attempt to probe, scan, or test the vulnerability of the Service or any related system or network, except as separately authorized in writing by the Company.</li>
          <li>Introduce viruses, malware, or any code intended to damage, disrupt, or gain unauthorized access to the Service.</li>
          <li>Use the Service to store, transmit, or process unlawful content, or to facilitate any illegal activity.</li>
          <li>Reverse-engineer, decompile, or attempt to extract the source code of the Service, except as permitted by law.</li>
          <li>Use automated means (bots, scrapers) to access or extract data from the Service without prior written consent.</li>
          <li>Use the Service to send unsolicited bulk communications (spam) to guests or third parties.</li>
          <li>Misrepresent guest data, falsify billing/GST records, or use the Service for fraudulent invoicing.</li>
          <li>Attempt to circumvent rate limiting, session controls, or other security mechanisms.</li>
        </ul>
      </LegalSection>
      <LegalSection title="4. Guest Data Handling by Properties">
        <ul className="list-disc pl-6 space-y-2">
          <li>Properties must collect and enter guest data (including ID proof) in compliance with applicable law, including local police/tourism registration requirements where applicable.</li>
          <li>Properties must not use guest data collected through the Service for any purpose beyond legitimate hotel operations and applicable legal/regulatory compliance.</li>
        </ul>
      </LegalSection>
      <LegalSection title="5. Consequences of Violation">
        <p>Violation of this AUP may result in suspension or termination of access to the Service, without prejudice to any other rights or remedies available to the Company, including recovery of any losses caused by such violation.</p>
      </LegalSection>
      <LegalSection title="6. Reporting Misuse">
        <p>If you become aware of any violation of this Acceptable Use Policy, please report it to <a className="text-teal-700 hover:underline" href="mailto:Consult@Growthstoryco.in">Consult@Growthstoryco.in</a> or call <a className="text-teal-700 hover:underline" href="tel:8007444464">8007444464</a>.</p>
      </LegalSection>
      <LegalSection title="7. Changes to this Policy">
        <p>This Acceptable Use Policy may be updated from time to time. Continued use of the Service after such updates constitutes acceptance of the revised policy.</p>
      </LegalSection>
      <LegalContact />
    </LegalPage>
  );
}