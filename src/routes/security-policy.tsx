import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalContact } from "@/components/LegalPage";

export const Route = createFileRoute("/security-policy")({
  head: () => ({
    meta: [
      { title: "Security Policy | HotelPilot" },
      { name: "description", content: "Technical and organizational security measures HotelPilot uses to protect Property and guest data." },
      { property: "og:title", content: "Security Policy | HotelPilot" },
      { property: "og:description", content: "HotelPilot security controls and practices." },
    ],
  }),
  component: SecurityPolicy,
});

function SecurityPolicy() {
  return (
    <LegalPage title="Security Policy">
      <LegalSection title="1. Overview">
        <p>Growth Story Company takes the security of HotelPilot.in and the data entrusted to it seriously. This Security Policy outlines the technical and organizational measures in place to protect Property and guest data.</p>
      </LegalSection>
      <LegalSection title="2. Access Control">
        <ul className="list-disc pl-6 space-y-2">
          <li>Role-based access control (RBAC) ensures staff only access features and data relevant to their role.</li>
          <li>All user accounts are created exclusively by authorized administrators (superadmin or property owner) — there is no public self-registration on the platform.</li>
          <li>Multi-property data isolation is enforced at the database level, ensuring one Property cannot access another Property's data.</li>
          <li>Two-Factor Authentication (2FA) via TOTP (e.g. Google Authenticator) is available/enforced for sensitive accounts.</li>
          <li>Session timeout and rate limiting are enforced to reduce the risk of unauthorized or automated access.</li>
        </ul>
      </LegalSection>
      <LegalSection title="3. Data Protection">
        <ul className="list-disc pl-6 space-y-2">
          <li>Row-Level Security (RLS) policies are applied across data tables, using security-definer database functions to enforce property-level and role-level data scoping.</li>
          <li>Data is encrypted in transit using industry-standard protocols (HTTPS/TLS).</li>
          <li>Sensitive operations (such as data wipe/reset) are restricted to the database level and are not exposed through the application interface, to prevent accidental or malicious data loss.</li>
        </ul>
      </LegalSection>
      <LegalSection title="4. Audit & Monitoring">
        <ul className="list-disc pl-6 space-y-2">
          <li>Key actions within the Service (such as billing changes, cancellations, and administrative actions) are logged for audit and accountability purposes.</li>
          <li>Soft-delete with audit trails is used for financial records such as bills, rather than permanent deletion, to preserve audit continuity.</li>
          <li>The platform undergoes periodic security review, including database-level security audits, with identified issues remediated on a prioritized basis.</li>
        </ul>
      </LegalSection>
      <LegalSection title="5. Input Validation & Application Security">
        <ul className="list-disc pl-6 space-y-2">
          <li>Input sanitization is applied to reduce risks such as injection attacks.</li>
          <li>Application code and infrastructure configuration are reviewed and updated on an ongoing basis as the platform evolves.</li>
        </ul>
      </LegalSection>
      <LegalSection title="6. Incident Response">
        <p>In the event of a suspected or confirmed security incident affecting Property or guest data, the Company will investigate promptly, take reasonable steps to contain and remediate the issue, and notify affected Properties in accordance with the Data Processing Agreement.</p>
      </LegalSection>
      <LegalSection title="7. Property & Staff Responsibilities">
        <ul className="list-disc pl-6 space-y-2">
          <li>Properties are responsible for safeguarding login credentials issued to their staff and for promptly reporting any suspected unauthorized access.</li>
          <li>Properties should promptly deactivate access for staff who no longer require it (e.g. upon termination of employment), by contacting the Company or their administrator.</li>
        </ul>
      </LegalSection>
      <LegalSection title="8. Reporting a Security Concern">
        <p>If you discover a potential security vulnerability or have concerns about the security of the Service, please report it immediately to <a className="text-teal-700 hover:underline" href="mailto:Consult@Growthstoryco.in">Consult@Growthstoryco.in</a> or call <a className="text-teal-700 hover:underline" href="tel:8007444464">8007444464</a>. We take all reports seriously and will investigate promptly.</p>
      </LegalSection>
      <LegalSection title="9. Changes to this Policy">
        <p>This Security Policy may be updated as our security practices evolve. Material changes will be communicated to Properties where appropriate.</p>
      </LegalSection>
      <LegalContact />
    </LegalPage>
  );
}