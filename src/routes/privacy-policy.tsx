import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalContact } from "@/components/LegalPage";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | HotelPilot" },
      {
        name: "description",
        content:
          "How HotelPilot and Growth Story Company collect, use, store, and protect Property and guest data.",
      },
      { property: "og:title", content: "Privacy Policy | HotelPilot" },
      {
        property: "og:description",
        content: "How HotelPilot handles Property and guest data.",
      },
    ],
  }),
  component: PrivacyPolicy,
});

function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="1. Introduction">
        <p>
          Growth Story Company ("we", "us", "our") operates HotelPilot.in, a multi-tenant
          hotel property management SaaS platform ("Service"). This Privacy Policy explains how
          we collect, use, store, and protect information when hotels ("Customer", "Property")
          and their staff use the Service, and how guest data entered into the Service by our
          Customers is handled.
        </p>
        <p>
          By using the Service, you agree to the collection and use of information in accordance
          with this policy.
        </p>
      </LegalSection>

      <LegalSection title="2. Information We Collect">
        <p>
          <strong>a) Account & Staff Information:</strong> Name, email address, phone number,
          role, and login credentials of hotel staff who are given access to the Service by the
          Property owner or administrator.
        </p>
        <p>
          <strong>b) Guest Information (entered by Customers):</strong> Guest name, contact
          number, email, ID proof details (as uploaded by the Property for KYC/registration
          purposes), stay history, billing details, and preferences. This data is entered and
          controlled by the Property; we process it strictly on the Property's instructions.
        </p>
        <p>
          <strong>c) Billing & Transaction Data:</strong> Invoices, GST details, payment records,
          and folio history generated within the Service.
        </p>
        <p>
          <strong>d) Technical Data:</strong> IP address, browser type, device information, log
          files, and usage patterns collected automatically for security and performance purposes.
        </p>
      </LegalSection>

      <LegalSection title="3. How We Use Information">
        <ul className="list-disc pl-6 space-y-2">
          <li>To provide, operate, and maintain the Service (front desk, billing, housekeeping, reporting, and related modules).</li>
          <li>To authenticate users and enforce role-based access control.</li>
          <li>To generate GST-compliant invoices and reports on behalf of the Property.</li>
          <li>To provide customer support and respond to queries.</li>
          <li>To monitor for security incidents, fraud, and misuse.</li>
          <li>To send service-related communications (updates, maintenance notices, billing reminders).</li>
          <li>To improve and develop new features of the Service.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Data Ownership">
        <p>
          All guest and operational data entered into the Service by a Property remains the
          property of that Property (the "Data Controller"). Growth Story Company acts as a
          "Data Processor" and processes such data only as necessary to provide the Service, and
          does not sell, rent, or share Property or guest data with third parties for marketing
          purposes.
        </p>
      </LegalSection>

      <LegalSection title="5. Data Sharing & Disclosure">
        <p>We do not sell personal data. We may share information only in the following circumstances:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>With sub-processors who help us host and operate the Service (e.g. cloud infrastructure and database providers), under confidentiality obligations.</li>
          <li>With OTA/channel manager partners, strictly where a Property has enabled such integrations.</li>
          <li>When required to comply with a legal obligation, court order, or governmental request.</li>
          <li>To protect the rights, property, or safety of the Company, our Customers, or the public.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Data Storage & Security">
        <p>
          Data is stored on secure, access-controlled cloud infrastructure with encryption in
          transit. We implement role-based access control, row-level security at the database
          level, audit logging, rate limiting, and two-factor authentication (2FA) for user
          accounts. Access to production data is restricted to authorized personnel only.
        </p>
        <p>
          While we take reasonable and industry-standard measures to protect data, no method of
          electronic transmission or storage is 100% secure, and we cannot guarantee absolute
          security.
        </p>
      </LegalSection>

      <LegalSection title="7. Data Retention">
        <p>
          We retain Property and guest data for as long as the Property's subscription is active,
          and for a reasonable period thereafter to comply with legal, tax, and accounting
          obligations (typically as required under Indian law), after which it may be archived or
          deleted upon request, subject to statutory retention requirements.
        </p>
      </LegalSection>

      <LegalSection title="8. Guest Rights">
        <p>
          Guests whose information is processed within the Service may contact the relevant
          Property directly to request access, correction, or deletion of their personal
          information, as the Property is the data controller. The Property may in turn raise
          such requests with us through the contact details below.
        </p>
      </LegalSection>

      <LegalSection title="9. Cookies">
        <p>
          The Service and marketing website may use cookies and similar technologies for
          authentication, session management, and analytics. Please refer to our separate Cookie
          Policy for details.
        </p>
      </LegalSection>

      <LegalSection title="10. Children's Data">
        <p>
          The Service is intended for business use by hotel staff and is not directed at children.
          We do not knowingly collect personal data from individuals under 18 for account creation
          purposes.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes to this Policy">
        <p>
          We may update this Privacy Policy from time to time. Material changes will be notified
          to Customers via email or in-app notice. Continued use of the Service after changes take
          effect constitutes acceptance of the revised policy.
        </p>
      </LegalSection>

      <LegalContact />
    </LegalPage>
  );
}