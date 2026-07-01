import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, LegalSection, LegalContact } from "@/components/LegalPage";

export const Route = createFileRoute("/cookie-policy")({
  head: () => ({
    meta: [
      { title: "Cookie Policy | HotelPilot" },
      { name: "description", content: "How HotelPilot.in uses cookies and similar technologies for authentication, preferences, and analytics." },
      { property: "og:title", content: "Cookie Policy | HotelPilot" },
      { property: "og:description", content: "HotelPilot cookie usage." },
    ],
  }),
  component: CookiePolicy,
});

function CookiePolicy() {
  return (
    <LegalPage title="Cookie Policy">
      <LegalSection title="1. What Are Cookies">
        <p>Cookies are small text files placed on your device when you visit a website or use a web application. They help the website remember your preferences and enable core functionality. This Cookie Policy explains how Growth Story Company uses cookies and similar technologies on the HotelPilot.in website and application.</p>
      </LegalSection>
      <LegalSection title="2. Types of Cookies We Use">
        <p><strong>a) Strictly Necessary Cookies:</strong> Required for core functionality such as logging in, maintaining your session, and enforcing security (e.g. session timeout, authentication tokens). The Service cannot function properly without these.</p>
        <p><strong>b) Preference Cookies:</strong> Remember settings such as selected property, language, or display preferences to improve your experience.</p>
        <p><strong>c) Analytics Cookies:</strong> Help us understand how the website and application are used, so we can improve performance and usability. These collect aggregated, non-identifying usage data where possible.</p>
      </LegalSection>
      <LegalSection title="3. Cookies We Do Not Use">
        <p>We do not use cookies for third-party advertising or to sell your browsing data to advertisers.</p>
      </LegalSection>
      <LegalSection title="4. Managing Cookies">
        <p>Most web browsers allow you to control cookies through their settings, including blocking or deleting cookies. Please note that disabling strictly necessary cookies may prevent core features of the Service (such as login and session management) from working correctly.</p>
      </LegalSection>
      <LegalSection title="5. Third-Party Cookies">
        <p>Where the Service integrates with third-party tools (such as payment, communication, or analytics providers in the future), those providers may set their own cookies subject to their respective privacy and cookie policies.</p>
      </LegalSection>
      <LegalSection title="6. Changes to this Policy">
        <p>We may update this Cookie Policy from time to time to reflect changes in technology or legal requirements. Please check this page periodically for updates.</p>
      </LegalSection>
      <LegalContact />
    </LegalPage>
  );
}