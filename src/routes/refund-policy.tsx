import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalContact } from "@/components/LegalPage";

export const Route = createFileRoute("/refund-policy")({
  head: () => ({
    meta: [
      { title: "Refund Policy | HotelPilot" },
      { name: "description", content: "HotelPilot refund, cancellation, and notice-period policy for setup fees, onboarding, and recurring subscriptions." },
      { property: "og:title", content: "Refund Policy | HotelPilot" },
      { property: "og:description", content: "HotelPilot refund and cancellation policy." },
    ],
  }),
  component: RefundPolicy,
});

function RefundPolicy() {
  return (
    <LegalPage title="Refund Policy">
      <LegalSection title="1. Overview">
        <p>This Refund Policy applies to all payments made by Customers ("Property") for use of HotelPilot.in, provided by Growth Story Company. Please read this policy carefully before making a payment.</p>
      </LegalSection>
      <LegalSection title="2. Setup Fee">
        <p>The one-time setup fee (covering property configuration, initial data setup, and system provisioning) is non-refundable once work on the setup has commenced, regardless of whether the Property continues, pauses, or discontinues use of the Service thereafter.</p>
      </LegalSection>
      <LegalSection title="3. Onboarding / Training Fee">
        <p>The one-time onboarding and training fee is non-refundable once the training session(s) have been scheduled or delivered, in part or in full.</p>
      </LegalSection>
      <LegalSection title="4. Recurring Subscription Fees (Monthly / 6-Month / 12-Month Plans)">
        <ul className="list-disc pl-6 space-y-2">
          <li>Recurring subscription fees are billed in advance for the selected billing cycle (monthly, 6-month, or 12-month).</li>
          <li>Subscription fees already paid for a billing cycle are non-refundable for that cycle, except where the Company is unable to provide the Service due to a fault attributable solely to the Company.</li>
          <li>To discontinue the Service, the Property must provide advance written notice as specified in Section 5 below. No refund will be issued for the notice period even if the Service is not actively used during that time.</li>
        </ul>
      </LegalSection>
      <LegalSection title="5. Cancellation & Notice Period">
        <p>A Property wishing to cancel or downgrade its subscription must provide the Company with at least 30 (thirty) days' written notice via email prior to the next billing cycle. Cancellation requests received after a billing cycle has commenced will take effect from the following cycle; no pro-rata refund will be issued for the current, already-invoiced cycle.</p>
      </LegalSection>
      <LegalSection title="6. Add-On Services">
        <p>Fees paid for optional add-ons (such as WhatsApp Billing & Automation) follow the same non-refundable policy as the recurring subscription fee, once activated.</p>
      </LegalSection>
      <LegalSection title="7. Exceptions">
        <p>Refunds may be considered at the sole discretion of the Company in cases of duplicate payment, billing error clearly attributable to the Company, or where the Company is unable to deliver the core Service for reasons entirely within its control. Any such refund, if approved, will be processed within a reasonable timeframe via the original mode of payment or bank transfer.</p>
      </LegalSection>
      <LegalSection title="8. How to Request Cancellation or Raise a Billing Concern">
        <p>All cancellation notices and billing concerns must be sent in writing to <a className="text-teal-700 hover:underline" href="mailto:Consult@Growthstoryco.in">Consult@Growthstoryco.in</a> or communicated to our support line at <a className="text-teal-700 hover:underline" href="tel:8007444464">8007444464</a>, quoting the Property name and account details.</p>
      </LegalSection>
      <LegalSection title="9. Changes to this Policy">
        <p>This Refund Policy may be updated from time to time. The version in effect at the time of your payment shall apply to that transaction.</p>
      </LegalSection>
      <LegalContact />
    </LegalPage>
  );
}