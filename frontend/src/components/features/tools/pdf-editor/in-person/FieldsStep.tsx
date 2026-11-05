/**
 * What the documents need filled in, asked once for all of them. Values from
 * the customer's record come filled in, to check. On a phone, only what's
 * blank is asked, one thing per screen, then a list shows everything to
 * check and jump back to; anything bigger gets one form.
 */
import React, { useEffect, useRef } from 'react';
import { Button, Checkbox, DatePicker, Input } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import type { Answers, Question } from './inPersonApi';
import { ActionBar } from './ui';

dayjs.extend(customParseFormat);

const DATE_FORMAT = 'MM/DD/YYYY';

const parseDate = (value: string): Dayjs | null => {
  const parsed = value ? dayjs(value, DATE_FORMAT, true) : null;
  return parsed && parsed.isValid() ? parsed : null;
};

const isChecked = (value: string | undefined) => ['true', '1', 'yes', 'on', 'checked'].includes((value ?? '').toLowerCase());

export const isAnswered = (question: Question, answers: Answers) => {
  const value = (answers[question.key] ?? '').trim();
  return question.kind === 'checkbox' ? isChecked(value) : !!value;
};

/** Required questions still without an answer */
export const missingRequired = (questions: Question[], answers: Answers) =>
  questions.filter((q) => q.required && !isAnswered(q, answers));

const QuestionInput: React.FC<{
  id: string;
  question: Question;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  onEnter?: () => void;
}> = ({ id, question, value, onChange, autoFocus, onEnter }) => {
  switch (question.kind) {
    case 'checkbox':
      return (
        <Checkbox id={id} checked={isChecked(value)} onChange={(e) => onChange(e.target.checked ? 'true' : '')}>
          Yes
        </Checkbox>
      );
    case 'date':
      return (
        <DatePicker
          id={id}
          className="ip-control"
          size="large"
          format={DATE_FORMAT}
          value={parseDate(value)}
          onChange={(date) => onChange(date ? date.format(DATE_FORMAT) : '')}
          inputReadOnly
          autoFocus={autoFocus}
        />
      );
    case 'multiline':
      return (
        <Input.TextArea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          autoFocus={autoFocus}
        />
      );
    default:
      return (
        <Input
          id={id}
          size="large"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPressEnter={onEnter}
          autoFocus={autoFocus}
          autoComplete="off"
          {...(question.kind === 'number' ? { inputMode: 'decimal' as const } : {})}
          {...(question.kind === 'phone' ? { type: 'tel', inputMode: 'tel' as const } : {})}
          {...(question.kind === 'email' ? { type: 'email', inputMode: 'email' as const, autoCapitalize: 'off' } : {})}
        />
      );
  }
};

/** Whose answer it is and where it goes, when that isn't obvious */
const questionMeta = (question: Question, documentCount: number, signerLabel: (role: string) => string) => {
  const parts: string[] = [];
  if (question.role) parts.push(signerLabel(question.role));
  if (documentCount > 1 && question.documents.length < documentCount) parts.push(question.documents.join(', '));
  if (question.source === 'company') parts.push('Missing from your company profile');
  return parts.join(' · ');
};

const Label: React.FC<{ question: Question; htmlFor: string; meta: string }> = ({ question, htmlFor, meta }) => (
  <label className="ip-label" htmlFor={htmlFor}>
    {question.label}
    {question.required && <span className="ip-required">Required</span>}
    {meta && <span className="ip-label-meta">{meta}</span>}
  </label>
);

const showValue = (question: Question, answers: Answers) => {
  const value = (answers[question.key] ?? '').trim();
  if (question.kind === 'checkbox') return isChecked(value) ? 'Yes' : '';
  return value;
};

interface FieldsStepProps {
  questions: Question[];
  answers: Answers;
  onAnswers: (answers: Answers) => void;
  documentCount: number;
  signerLabel: (role: string) => string;
  isPhone: boolean;
  /** Keys asked one by one on a phone: what was blank when the visit started */
  sequence: string[];
  /** On a phone: a question's key, or the review list */
  screen: string | 'review' | null;
  fromReview: boolean;
  onShow: (screen: string | 'review', fromReview?: boolean) => void;
  onBack: () => void;
  onDone: () => void;
}

const FieldsStep: React.FC<FieldsStepProps> = ({
  questions, answers, onAnswers, documentCount, signerLabel, isPhone,
  sequence, screen, fromReview, onShow, onBack, onDone,
}) => {
  const missing = missingRequired(questions, answers);
  const set = (key: string, value: string) => onAnswers({ ...answers, [key]: value });
  const fromRecord = questions.some((q) => q.source === 'customer');

  // Nothing to fill in: straight on to signing
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (questions.length === 0) done.current();
  }, [questions.length]);
  if (questions.length === 0) return null;

  const neededText = missing.length > 0
    ? `Still needed: ${missing.map((q) => q.label).join(', ')}`
    : undefined;

  if (!isPhone) {
    return (
      <>
        <h1 className="ip-title">Fill in the details</h1>
        <p className="ip-lead">
          {fromRecord
            ? 'The customer’s details are filled in from their record. Changes here go on these documents, and anything that was blank is saved to the customer.'
            : 'These go on the documents before they’re signed.'}
        </p>
        <div className="ip-panel">
          {questions.map((question, index) => {
            const id = `ip-q-${index}`;
            return (
              <div key={question.key} className="ip-field">
                <Label question={question} htmlFor={id} meta={questionMeta(question, documentCount, signerLabel)} />
                <QuestionInput
                  id={id}
                  question={question}
                  value={answers[question.key] ?? ''}
                  onChange={(value) => set(question.key, value)}
                  autoFocus={index === 0 && !question.value}
                />
              </div>
            );
          })}
        </div>
        <ActionBar text={neededText}>
          <Button size="large" onClick={onBack}>Back</Button>
          <Button type="primary" size="large" disabled={missing.length > 0} onClick={onDone}>
            Continue to sign
          </Button>
        </ActionBar>
      </>
    );
  }

  const current = screen ?? (sequence[0] || 'review');
  const index = questions.findIndex((q) => q.key === current);

  if (current === 'review' || index < 0) {
    return (
      <>
        <h1 className="ip-title">Check the details</h1>
        <p className="ip-lead">Tap a line to change it.</p>
        <ul className="ip-rows">
          {questions.map((question) => {
            const value = showValue(question, answers);
            const meta = questionMeta(question, documentCount, signerLabel);
            return (
              <li key={question.key}>
                <button type="button" className="ip-review-row" onClick={() => onShow(question.key, true)}>
                  <span className="ip-review-label">
                    {question.label}
                    {meta && <span className="ip-row-meta" style={{ display: 'block' }}>{meta}</span>}
                  </span>
                  <span className="ip-review-value">
                    {value || (
                      <span className={`ip-tag${question.required ? ' ip-tag--warn' : ''}`} style={{ marginLeft: 0 }}>
                        {question.required ? 'Required' : 'Blank'}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <ActionBar text={neededText}>
          <Button size="large" onClick={onBack}>Back</Button>
          <Button type="primary" size="large" disabled={missing.length > 0} onClick={onDone}>
            Continue to sign
          </Button>
        </ActionBar>
      </>
    );
  }

  const question = questions[index];
  const position = sequence.indexOf(question.key);
  const answered = isAnswered(question, answers);
  const next = () => {
    // Back to the list it came from, without stacking another copy of it
    if (fromReview) {
      onBack();
      return;
    }
    const after = sequence.slice(position + 1)[0];
    onShow(after ?? 'review');
  };
  // A required one can't be skipped; from the list, Done goes back to it either way
  const blocked = question.required && !answered && !fromReview;
  const meta = questionMeta(question, documentCount, signerLabel);

  return (
    <div key={question.key} className="ip-question">
      <h1 className="ip-title">
        <label htmlFor="ip-q-current">{question.label}</label>
      </h1>
      <p className="ip-count">
        {position >= 0 && !fromReview ? `${position + 1} of ${sequence.length}` : null}
        {question.required && <span className="ip-required" style={{ marginLeft: position >= 0 ? 8 : 0 }}>Required</span>}
        {meta && <span style={{ display: 'block', marginTop: 2 }}>{meta}</span>}
      </p>
      <QuestionInput
        id="ip-q-current"
        question={question}
        value={answers[question.key] ?? ''}
        onChange={(value) => set(question.key, value)}
        autoFocus={question.kind !== 'date' && question.kind !== 'checkbox'}
        onEnter={answered ? next : undefined}
      />
      <ActionBar>
        {!fromReview && <Button size="large" onClick={onBack}>Back</Button>}
        <Button type={answered || fromReview ? 'primary' : 'default'} size="large" disabled={blocked} onClick={next}>
          {fromReview ? 'Done' : answered ? 'Next' : 'Skip'}
        </Button>
      </ActionBar>
    </div>
  );
};

export default FieldsStep;
