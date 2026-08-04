import React, { useState } from 'react';
import { Modal, Steps, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FileTextOutlined,
  DollarOutlined,
  UserOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { colors, fonts } from '@/styles/theme';

interface OnboardingWizardProps {
  userId: string;
  open: boolean;
  onClose: () => void;
}

const TOTAL_STEPS = 3;

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ userId, open, onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [skipHovered, setSkipHovered] = useState(false);
  const navigate = useNavigate();

  const persistDone = () => {
    if (userId) {
      localStorage.setItem(`onboarding_${userId}`, 'done');
    }
  };

  const handleComplete = () => {
    persistDone();
    onClose();
  };

  const handleSkip = () => {
    persistDone();
    onClose();
  };

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setDirection(1);
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep(currentStep - 1);
    }
  };

  const featureCards = [
    {
      icon: <FileTextOutlined style={{ fontSize: 18 }} />,
      title: 'Estimates',
      description: 'Build detailed estimates with line items and send them to customers.',
      iconBg: colors.bgSunken,
      iconFg: colors.textPrimary,
    },
    {
      icon: <DollarOutlined style={{ fontSize: 18 }} />,
      title: 'Invoices',
      description: 'Convert approved estimates to invoices and track payments.',
      iconBg: colors.accentSubtle,
      iconFg: colors.accent,
    },
    {
      icon: <UserOutlined style={{ fontSize: 18 }} />,
      title: 'Customers',
      description: 'Manage your customer list and attach them to documents.',
      iconBg: colors.successBg,
      iconFg: colors.success,
    },
  ];

  const settingsChecklist = [
    'Company name, logo, and contact info',
    'Default tax rate for estimates',
    'Custom document numbering format',
    'Branding on PDF exports',
  ];

  const stepContent: React.ReactNode[] = [
    // Step 1 — Welcome
    <div key="step-0">
      <h2
        style={{
          fontFamily: fonts.heading,
          fontSize: 22,
          fontWeight: 700,
          color: colors.textPrimary,
          margin: '0 0 8px',
          letterSpacing: '-0.01em',
        }}
      >
        Welcome to ScopeIt! 🎉
      </h2>
      <p style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
        ScopeIt helps restoration contractors create estimates, track invoices, and manage customers — all in one place.
      </p>
      <div
        style={{
          borderRadius: 12,
          border: `1px solid ${colors.border}`,
          background: colors.bgWhite,
          overflow: 'hidden',
        }}
      >
        {featureCards.map((card, index) => (
          <div
            key={card.title}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
              padding: '14px 16px',
              borderBottom: index < featureCards.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: card.iconBg,
                color: card.iconFg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {card.icon}
            </div>
            <div>
              <div
                style={{
                  fontFamily: fonts.heading,
                  fontWeight: 600,
                  fontSize: 14,
                  color: colors.textPrimary,
                  marginBottom: 2,
                }}
              >
                {card.title}
              </div>
              <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.4 }}>
                {card.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>,

    // Step 2 — Set Up Company
    <div key="step-1">
      <h2
        style={{
          fontFamily: fonts.heading,
          fontSize: 22,
          fontWeight: 700,
          color: colors.textPrimary,
          margin: '0 0 8px',
          letterSpacing: '-0.01em',
        }}
      >
        Set up your company
      </h2>
      <p style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
        Add your company details for professional estimates and invoices.
      </p>
      <div
        style={{
          marginBottom: 24,
          borderRadius: 12,
          border: `1px solid ${colors.border}`,
          background: colors.bgLight,
          padding: '4px 16px',
        }}
      >
        {settingsChecklist.map((item, index) => (
          <div
            key={item}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '11px 0',
              borderBottom: index < settingsChecklist.length - 1 ? `1px solid ${colors.border}` : 'none',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: colors.textMuted,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 14, color: colors.textPrimary }}>{item}</span>
          </div>
        ))}
      </div>
      <Button
        icon={<SettingOutlined />}
        onClick={() => {
          navigate('/app/settings');
          handleComplete();
        }}
        style={{ borderRadius: 6, fontWeight: 600 }}
      >
        Go to Settings
      </Button>
    </div>,

    // Step 3 — Get Started
    <div key="step-2" style={{ textAlign: 'center' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: colors.accentSubtle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
        }}
      >
        <FileTextOutlined style={{ fontSize: 26, color: colors.accent }} />
      </div>
      <h2
        style={{
          fontFamily: fonts.heading,
          fontSize: 22,
          fontWeight: 700,
          color: colors.textPrimary,
          margin: '0 0 8px',
          letterSpacing: '-0.01em',
        }}
      >
        You're all set!
      </h2>
      <p
        style={{
          color: colors.textSecondary,
          fontSize: 14,
          lineHeight: 1.5,
          maxWidth: 320,
          margin: '0 auto 28px',
        }}
      >
        Start by creating your first estimate — it only takes a minute.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <Button
          type="primary"
          size="large"
          icon={<FileTextOutlined />}
          onClick={() => {
            handleComplete();
            navigate('/app/estimates/new');
          }}
          style={{
            background: colors.primary,
            fontWeight: 600,
            borderRadius: 8,
            width: 220,
            height: 44,
          }}
        >
          Create Estimate
        </Button>
        <Button
          size="large"
          onClick={() => {
            handleComplete();
            navigate('/app/dashboard');
          }}
          style={{ borderRadius: 8, width: 220, height: 44, fontWeight: 600 }}
        >
          Explore Dashboard
        </Button>
      </div>
    </div>,
  ];

  const isLastStep = currentStep === TOTAL_STEPS - 1;

  const slideVariants = {
    enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 16 : -16 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -16 : 16 }),
  };

  return (
    <Modal
      open={open}
      footer={null}
      onCancel={handleSkip}
      maskClosable={false}
      width={480}
      styles={{
        body: { padding: '32px 32px 24px' },
        content: { maxWidth: 'calc(100vw - 32px)' },
      }}
    >
      <Steps
        current={currentStep}
        size="small"
        style={{ marginBottom: 28 }}
        items={[
          { title: 'Welcome' },
          { title: 'Company' },
          { title: 'Get Started' },
        ]}
      />

      <div style={{ minHeight: 280, overflow: 'hidden' }}>
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {stepContent[currentStep]}
          </motion.div>
        </AnimatePresence>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 28,
          paddingTop: 20,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        <button
          onClick={handleSkip}
          onMouseEnter={() => setSkipHovered(true)}
          onMouseLeave={() => setSkipHovered(false)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: skipHovered ? colors.textSecondary : colors.textMuted,
            fontSize: 13,
            padding: 0,
            transition: 'color 0.15s ease',
          }}
        >
          Skip for now
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          {currentStep > 0 && (
            <Button onClick={handleBack} style={{ borderRadius: 6 }}>
              Back
            </Button>
          )}
          {!isLastStep && (
            <Button
              type="primary"
              onClick={handleNext}
              style={{ background: colors.primary, borderRadius: 6, fontWeight: 600 }}
            >
              Next
            </Button>
          )}
          {isLastStep && (
            <Button
              type="primary"
              onClick={handleComplete}
              style={{ background: colors.primary, borderRadius: 6, fontWeight: 600 }}
            >
              Get Started
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default OnboardingWizard;
