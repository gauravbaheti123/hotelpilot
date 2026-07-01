import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalContact } from "@/components/LegalPage";

export const Route = createFileRoute("/terms-of-service")({
  head: () => ({
    meta: [
      { title: "Terms of Service | HotelPilot" },
      {
        name: "description",
        content:
          "Terms governing access to and use of HotelPilot.in, the multi-tenant hotel property management platform by Growth Story Company.",
      },
      { property: "og:title", content: "Terms of Service | HotelPilot" },
      { property: "og:description", content: "Terms governing use of HotelPilot.in." },
    ],
  }),
  component: TermsOfService,
});

function TermsOfService() {
  return (
    <LegalPage title="Terms of Service">
      <LegalSection title="1. Acceptance of Terms">
        <p>
          These Terms of Service ("Terms") govern access to and use of HotelPilot.in (the
          "Service"), provided by Growth Story Company ("Company", "we", "us"). By creating
          an account, signing an order form, or using the Service, the Customer ("you",
          "Property") agrees to be bound by these Terms.
        </p>
      </LegalSection>

      <LegalSection title="2. The Service">
        <p>
          HotelPilot.in is a multi-tenant, cloud-based hotel property management system (PMS)
          providing modules including but not limited to front desk operations, room and tariff
          management, food & kitchen order ticketing (KOT), banquet and event management, billing
          and GST invoicing, housekeeping, night audit, staff management, guest CRM, inventory,
          reporting, and channel manager integrations.
        </p>
      </LegalSection>

      <LegalSection title="3. Account Registration & Access">
        <ul className="list-disc pl-6 space-y-2">
          <li>All user accounts on the Service are created by our Company (superadmin) or by the Property's designated administrator. There is no public self-registration.</li>
          <li>The Property is responsible for maintaining the confidentiality of login credentials issued to its staff and for all activity occurring under those accounts.</li>
          <li>The Property must promptly notify us of any unauthorized access or security breach.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Subscription, Fees & Payment">
        <ul className="list-disc pl-6 space-y-2">
          <li>Use of the Service requires payment of a one-time setup fee, a one-time onboarding/training fee, and a recurring subscription fee (monthly, 6-month, or 12-month plan, as selected by the Property).</li>
          <li>Optional add-ons (such as WhatsApp Billing & Automation) may be charged separately as agreed.</li>
          <li>Fees are payable in advance for the selected billing cycle, via the payment method agreed with the Company at the time of onboarding (bank transfer/invoice-based payment; no automated payment gateway is used at this time).</li>
          <li>Late payment may result in suspension of access to the Service until dues are cleared.</li>
          <li>Fees are exclusive of applicable taxes unless stated otherwise.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Customer Responsibilities">
        <ul className="list-disc pl-6 space-y-2">
          <li>Ensure the accuracy of data entered into the Service, including guest information, tariffs, and billing details.</li>
          <li>Use the Service only for lawful hotel/hospitality management purposes.</li>
          <li>Ensure staff granted access comply with these Terms and applicable law, including data protection obligations towards guests.</li>
          <li>Maintain their own backups of critical business records where required by law, in addition to data held on the Service.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Acceptable Use">
        <p>
          The Property agrees not to misuse the Service, including but not limited to: attempting
          unauthorized access to other properties' data, reverse-engineering the Service,
          introducing malicious code, or using the Service to violate any applicable law. See our
          separate Acceptable Use Policy for full details.
        </p>
      </LegalSection>

      <LegalSection title="7. Intellectual Property">
        <p>
          HotelPilot.in, including its software, design, branding, and underlying technology, is
          and remains the exclusive property of Growth Story Company. These Terms do not grant the
          Customer any ownership rights in the Service, only a limited, non-exclusive,
          non-transferable right to use it for the duration of the subscription.
        </p>
      </LegalSection>

      <LegalSection title="8. Data Ownership">
        <p>
          As set out in our Privacy Policy, all guest and operational data entered by the Property
          remains owned by the Property. The Company acts only as a service provider/data
          processor in relation to such data.
        </p>
      </LegalSection>

      <LegalSection title="9. Service Availability">
        <p>
          We aim to provide reliable, continuously available service, subject to scheduled
          maintenance and factors outside our reasonable control. Specific uptime commitments,
          where applicable, are set out in our Service Level Agreement (SLA).
        </p>
      </LegalSection>

      <LegalSection title="10. Suspension & Termination">
        <ul className="list-disc pl-6 space-y-2">
          <li>We may suspend or terminate access to the Service for non-payment, breach of these Terms, or misuse that risks the security or integrity of the platform or other Customers' data.</li>
          <li>The Property may terminate its subscription by providing written notice as per the notice period specified in our Refund Policy.</li>
          <li>Upon termination, the Property may request export of its data within a reasonable period, after which data may be archived or deleted as per our data retention practices.</li>
        </ul>
      </LegalSection>

      <LegalSection title="11. Limitation of Liability">
        <p>
          To the maximum extent permitted by law, Growth Story Company's total liability arising
          out of or relating to the Service shall not exceed the fees paid by the Property in the
          three (3) months preceding the claim. We shall not be liable for indirect, incidental,
          or consequential damages, including loss of revenue or business, arising from use of or
          inability to use the Service.
        </p>
      </LegalSection>

      <LegalSection title="12. Disclaimer of Warranties">
        <p>
          The Service is provided on an "as is" and "as available" basis. While we strive for
          accuracy and reliability, we do not warrant that the Service will be error-free or
          uninterrupted at all times.
        </p>
      </LegalSection>

      <LegalSection title="13. Modifications to the Service or Terms">
        <p>
          We may update these Terms or modify features of the Service from time to time. Material
          changes will be communicated to Customers in advance where reasonably possible.
          Continued use after such changes constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection title="14. Governing Law & Jurisdiction">
        <p>
          These Terms shall be governed by the laws of India. Subject to applicable law, the
          courts at Latur, Maharashtra shall have exclusive jurisdiction over any disputes arising
          out of or in connection with these Terms.
        </p>
      </LegalSection>

      <LegalContact />
    </LegalPage>
  );
}