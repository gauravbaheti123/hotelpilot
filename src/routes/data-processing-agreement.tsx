import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalContact } from "@/components/LegalPage";

export const Route = createFileRoute("/data-processing-agreement")({
  head: () => ({
    meta: [
      { title: "Data Processing Agreement | HotelPilot" },
      { name: "description", content: "Data Processing Agreement between Growth Story Company and Properties using HotelPilot.in." },
      { property: "og:title", content: "Data Processing Agreement | HotelPilot" },
      { property: "og:description", content: "HotelPilot DPA for Property customers." },
    ],
  }),
  component: DPA,
});

function DPA() {
  return (
    <LegalPage title="Data Processing Agreement">
      <LegalSection title="1. Purpose">
        <p>This Data Processing Agreement ("DPA") forms part of the agreement between the Property ("Data Controller") and Growth Story Company ("Data Processor", "Company") for use of HotelPilot.in (the "Service"). It sets out the terms under which the Company processes personal data on behalf of the Property in connection with the Service.</p>
      </LegalSection>
      <LegalSection title="2. Roles of the Parties">
        <p>The Property acts as the Data Controller in respect of guest personal data (name, contact details, ID proof, stay history, billing information) entered into the Service. The Company acts as the Data Processor, processing such data solely on the Property's documented instructions, as provided through the ordinary functionality of the Service.</p>
      </LegalSection>
      <LegalSection title="3. Scope & Nature of Processing">
        <ul className="list-disc pl-6 space-y-2">
          <li><strong>Nature of processing:</strong> Storage, retrieval, organization, and display of guest and operational data through the Service's front desk, billing, housekeeping, KOT, banquet, reporting, and related modules.</li>
          <li><strong>Categories of data subjects:</strong> Hotel guests, and the Property's own staff/users.</li>
          <li><strong>Categories of personal data:</strong> Name, contact number, email, ID proof details, address, stay and billing history, and staff login credentials.</li>
          <li><strong>Duration:</strong> For the term of the Property's subscription, and thereafter as set out in the Privacy Policy's data retention terms.</li>
        </ul>
      </LegalSection>
      <LegalSection title="4. Processor Obligations">
        <ul className="list-disc pl-6 space-y-2">
          <li>Process personal data only as necessary to provide the Service and in accordance with the Property's instructions, this DPA, and applicable law.</li>
          <li>Ensure personnel authorized to process data are subject to confidentiality obligations.</li>
          <li>Implement appropriate technical and organizational security measures, including role-based access control, row-level security, encryption in transit, audit logging, rate limiting, and two-factor authentication.</li>
          <li>Assist the Property, where reasonably possible, in responding to data subject requests (access, correction, deletion) received from guests.</li>
          <li>Notify the Property without undue delay upon becoming aware of a personal data breach affecting the Property's data.</li>
          <li>Not engage a new sub-processor materially affecting the processing without informing the Property, except for existing infrastructure/hosting sub-processors necessary to operate the Service.</li>
        </ul>
      </LegalSection>
      <LegalSection title="5. Controller Obligations">
        <ul className="list-disc pl-6 space-y-2">
          <li>Ensure it has a lawful basis for collecting and providing guest personal data to the Service (e.g. for hotel registration/KYC purposes as required under applicable law).</li>
          <li>Ensure the accuracy of data entered into the Service.</li>
          <li>Respond to and fulfil data subject rights requests, with reasonable technical assistance from the Company as set out above.</li>
        </ul>
      </LegalSection>
      <LegalSection title="6. Sub-Processors">
        <p>The Company uses reputable third-party cloud infrastructure and database hosting providers (sub-processors) to operate the Service. These sub-processors are bound by confidentiality and data protection obligations no less protective than those in this DPA.</p>
      </LegalSection>
      <LegalSection title="7. Data Transfers">
        <p>Personal data is hosted on secure cloud infrastructure. Where data is processed or stored outside India by an infrastructure sub-processor, the Company will ensure such processing is subject to appropriate contractual and security safeguards.</p>
      </LegalSection>
      <LegalSection title="8. Security Incident Response">
        <p>In the event of a confirmed personal data breach affecting the Property's data, the Company will notify the Property promptly upon confirmation, describe the nature of the breach to the extent known, and take reasonable steps to contain and remediate the incident.</p>
      </LegalSection>
      <LegalSection title="9. Deletion or Return of Data">
        <p>Upon termination of the Property's subscription, the Company will, upon written request, make the Property's data available for export within a reasonable period, and thereafter delete or anonymize such data in accordance with the Privacy Policy's retention terms, save where retention is required by applicable law.</p>
      </LegalSection>
      <LegalSection title="10. Liability & Governing Law">
        <p>Liability under this DPA is subject to the limitations set out in the Terms of Service. This DPA is governed by the laws of India, with the courts at Latur, Maharashtra having exclusive jurisdiction.</p>
      </LegalSection>
      <LegalContact />
    </LegalPage>
  );
}