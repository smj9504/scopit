import React from 'react';
import LegalLayout from '@/components/LegalLayout';
import { Seo } from '@/components/Seo';

const PrivacyPolicyPage: React.FC = () => {
  return (
    <>
      <Seo
        title="Privacy Policy | Scopit"
        description="How Scopit collects, uses, shares, and protects your information, and the privacy rights available to you, including U.S. state privacy rights."
        path="/privacy"
      />
      <LegalLayout title="Privacy Policy" lastUpdated="August 14, 2026">
        <p>
          This Privacy Policy explains how Scopit (&ldquo;Scopit,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
          &ldquo;our&rdquo;) collects, uses, shares, and protects information about you when you use our website at{' '}
          <a href="https://www.scopit.work">www.scopit.work</a> and our estimating and invoicing software and related
          services (collectively, the &ldquo;Service&rdquo;). Scopit is operated by a company based in the Republic of
          Korea, and our Service is offered primarily to users in the United States.
        </p>
        <p>
          By using the Service, you agree to the collection and use of information in accordance with this Policy. If you
          do not agree, please do not use the Service.
        </p>

        <h2>1. Information We Collect</h2>

        <h3>Information you provide to us</h3>
        <ul>
          <li>
            <strong>Account information</strong> — your name, email address, company name, and password when you create
            an account.
          </li>
          <li>
            <strong>Content you enter</strong> — the business data you create or upload in the Service, such as
            customers, estimates, invoices, line items, notes, and photos or files you attach.
          </li>
          <li>
            <strong>Public estimate requests</strong> — if you use our public packing-estimate form, we collect your
            contact email, and optionally your phone number, company phone, company address, property address, and the
            room photos you upload.
          </li>
          <li>
            <strong>Communications</strong> — information you provide when you contact us for support or otherwise
            correspond with us.
          </li>
        </ul>

        <h3>Information from Google (Sign in with Google)</h3>
        <p>
          If you choose to sign in with Google, Google shares with us basic profile information such as your name, email
          address, and profile identifier, in accordance with the permissions you grant. We do not receive your Google
          password.
        </p>

        <h3>Information collected automatically</h3>
        <p>
          When you use the Service, we automatically collect certain technical information, including your IP address,
          device and browser type, and log data. We use cookies and similar local-storage technologies that are
          necessary to keep you signed in and to remember your preferences.
        </p>

        <h2>2. How We Use Information</h2>
        <ul>
          <li>To provide, operate, maintain, and secure the Service and your account.</li>
          <li>To authenticate you and keep your session active.</li>
          <li>
            To generate packing estimates from photos you upload, which are processed by our third-party AI provider (see
            &ldquo;AI Processing&rdquo; below).
          </li>
          <li>To send transactional messages, such as email verification, password resets, and service notices.</li>
          <li>To respond to your requests and provide customer support.</li>
          <li>To monitor, improve, and develop the Service.</li>
          <li>To detect, prevent, and address security incidents, fraud, and abuse.</li>
          <li>To comply with legal obligations and enforce our terms.</li>
        </ul>

        <h2>3. AI Processing</h2>
        <p>
          When you submit photos for an estimate, those images and related inputs are sent to our AI provider (Anthropic)
          to analyze the contents and generate your estimate. Under that provider&rsquo;s terms applicable to our use,
          your inputs are not used to train the provider&rsquo;s models. AI-generated estimates are provided for your
          convenience and may contain errors; you are responsible for reviewing and verifying them before relying on
          them.
        </p>

        <h2>4. How We Share Information</h2>
        <p>
          We do <strong>not</strong> sell your personal information. We share information only in the following
          circumstances:
        </p>
        <ul>
          <li>
            <strong>Service providers.</strong> We use trusted third parties to run the Service, who process information
            on our behalf, including Google (authentication), Anthropic (AI processing), Cloudflare R2 (file storage),
            Neon (database hosting), Render (application hosting), Vercel (website hosting), and our email delivery
            provider. These providers are permitted to use the information only to provide services to us.
          </li>
          <li>
            <strong>Legal reasons.</strong> We may disclose information if required by law or to protect the rights,
            property, or safety of Scopit, our users, or others.
          </li>
          <li>
            <strong>Business transfers.</strong> If we are involved in a merger, acquisition, or sale of assets, your
            information may be transferred as part of that transaction.
          </li>
          <li>
            <strong>With your consent.</strong> We may share information for other purposes with your direction or
            consent.
          </li>
        </ul>

        <h2>5. International Data Transfers</h2>
        <p>
          Scopit is operated from the Republic of Korea, and our service providers may store and process information in
          the United States and other countries. Where you access the Service from outside these locations, you
          understand that your information may be transferred to, stored, and processed in countries whose data
          protection laws may differ from those in your jurisdiction. We take steps to protect your information as
          described in this Policy wherever it is processed.
        </p>

        <h2>6. Data Retention</h2>
        <p>
          We retain your account information and content for as long as your account is active. If you request deletion
          of your account (see &ldquo;Your Privacy Rights&rdquo; below), we will delete your personal information within
          30 days, except for limited records we are required to keep to comply with legal, tax, or accounting
          obligations, resolve disputes, or enforce our agreements. Residual copies may remain in encrypted backups for a
          short period until those backups are cycled out.
        </p>
        <p>
          Information submitted through our public packing-estimate form is kept only briefly: unverified requests are
          automatically deleted about 24 hours after submission, and verified estimates (including any photos you
          uploaded) are automatically deleted about 14 days after submission. Email verification codes expire within 15
          minutes.
        </p>

        <h2>7. Security</h2>
        <p>
          We use industry-standard safeguards to protect your information, including encryption in transit, access
          controls, secure cloud hosting, and regular backups. However, no method of transmission or storage is
          completely secure, and we cannot guarantee absolute security.
        </p>

        <h2>8. Your Privacy Rights</h2>
        <p>
          Depending on where you live, you may have rights regarding your personal information. Because our Service is
          offered primarily to users in the United States, the following describes rights available under U.S. state
          privacy laws.
        </p>

        <h3>California residents (CCPA/CPRA)</h3>
        <p>
          If you are a California resident, you have the right to know what personal information we collect and how we
          use and disclose it, to request access to and deletion of your personal information, to request correction of
          inaccurate information, and to be free from discrimination for exercising these rights. We do not sell or
          &ldquo;share&rdquo; your personal information as those terms are defined under California law. You may use an
          authorized agent to submit a request on your behalf.
        </p>

        <h3>Residents of other U.S. states</h3>
        <p>
          Residents of states with comprehensive privacy laws (such as Virginia, Colorado, Connecticut, and others) may
          have similar rights to access, correct, delete, and obtain a copy of their personal information, and to opt out
          of certain processing. We do not sell personal information or use it for targeted advertising.
        </p>

        <h3>How to exercise your rights</h3>
        <p>
          To exercise any of these rights, email us at{' '}
          <a href="mailto:hello@scopit.work">hello@scopit.work</a>. We will verify your request and respond as required
          by applicable law. We will not discriminate against you for exercising your privacy rights.
        </p>

        <h2>9. Children&rsquo;s Privacy</h2>
        <p>
          The Service is intended for business use and is not directed to children. We do not knowingly collect personal
          information from children under 16. If you believe a child has provided us with personal information, please
          contact us and we will take steps to delete it.
        </p>

        <h2>10. Third-Party Links</h2>
        <p>
          The Service may contain links to third-party websites or services that we do not control. This Policy does not
          apply to those third parties, and we encourage you to review their privacy policies.
        </p>

        <h2>11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we do, we will revise the &ldquo;Last updated&rdquo;
          date at the top of this page, and, where appropriate, provide additional notice. Your continued use of the
          Service after changes take effect constitutes acceptance of the updated Policy.
        </p>

        <h2>12. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or our privacy practices, contact us at{' '}
          <a href="mailto:hello@scopit.work">hello@scopit.work</a>.
        </p>
      </LegalLayout>
    </>
  );
};

export default PrivacyPolicyPage;
