/**
 * Progressive form handling for the inquiry, application, and newsletter
 * forms. Sends the form as flat JSON (keys = field names), shows field errors
 * from the server inline and in an error summary, and swaps in the success
 * panel. No data is stored in the browser.
 *
 * Markup contract:
 *   <form data-js-form action="/api/..." novalidate>
 *     <div data-error-summary hidden tabindex="-1"><h2>…</h2><ul></ul></div>
 *     <input id="email" name="email" aria-describedby="email-error">
 *     <p class="field__error" id="email-error"></p>
 *     … multi-value groups: <fieldset id="adjusters" data-multi="adjusters">
 *     <p class="form-status" role="status" data-status></p>
 *     <button type="submit">
 *   </form>
 *   <div data-success-for="form-id" hidden tabindex="-1">…</div>
 */

declare global {
  interface Window {
    turnstile?: { reset(widget?: string | HTMLElement): void };
  }
}

type Fields = Record<string, string | string[]>;
type ServerReply = { ok: boolean; message?: string; errors?: Record<string, string>; [key: string]: unknown };

export interface FormOptions {
  /** Extra checks before sending. Return field errors to block the send. */
  validate?: (form: HTMLFormElement, data: Fields) => Record<string, string>;
  /** Called with the server reply after a successful send. */
  onSuccess?: (reply: ServerReply, form: HTMLFormElement) => void;
}

export function serialize(form: HTMLFormElement): Fields {
  const out: Fields = {};
  for (const [key, value] of new FormData(form)) {
    if (typeof value !== 'string') continue;
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  form.querySelectorAll<HTMLElement>('[data-multi]').forEach((el) => {
    const name = el.dataset.multi as string;
    const v = out[name];
    out[name] = v === undefined ? [] : Array.isArray(v) ? v : [v];
  });
  return out;
}

function fieldLabel(form: HTMLFormElement, name: string): string {
  const el = form.querySelector<HTMLElement>(`#${CSS.escape(name)}`);
  if (!el) return '';
  if (el.dataset.label) return el.dataset.label;
  if (el instanceof HTMLFieldSetElement) return el.querySelector('legend')?.textContent?.trim() || name;
  const label = form.querySelector(`label[for="${CSS.escape(name)}"]`);
  return label?.textContent?.replace(/\s*\(optional\)\s*/i, '').trim() || name;
}

function clearErrors(form: HTMLFormElement) {
  form.querySelectorAll<HTMLElement>('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll<HTMLElement>('.field__error').forEach((el) => (el.textContent = ''));
  const summary = form.querySelector<HTMLElement>('[data-error-summary]');
  if (summary) {
    summary.hidden = true;
    summary.querySelector('ul')!.innerHTML = '';
  }
  setStatus(form, '');
}

function setStatus(form: HTMLFormElement, message: string) {
  const status = form.querySelector<HTMLElement>('[data-status]');
  if (status) status.textContent = message;
}

function showErrors(form: HTMLFormElement, errors: Record<string, string>, message?: string) {
  const summary = form.querySelector<HTMLElement>('[data-error-summary]');
  const list = summary?.querySelector('ul');
  for (const [name, text] of Object.entries(errors)) {
    const target = form.querySelector<HTMLElement>(`#${CSS.escape(name)}`);
    const errorEl = form.querySelector<HTMLElement>(`#${CSS.escape(name)}-error`);
    if (errorEl) errorEl.textContent = text;
    if (target && !(target instanceof HTMLFieldSetElement)) target.setAttribute('aria-invalid', 'true');
    if (list) {
      const li = document.createElement('li');
      const label = fieldLabel(form, name);
      if (label) {
        const a = document.createElement('a');
        a.href = `#${name}`;
        a.textContent = `${label}: ${text}`;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          focusField(form, name);
        });
        li.append(a);
      } else {
        li.textContent = text;
      }
      list.append(li);
    }
  }
  if (summary && list && list.children.length) {
    const heading = summary.querySelector('h2');
    if (heading) heading.textContent = message || 'Please fix the following:';
    summary.hidden = false;
    summary.focus();
  } else if (message) {
    setStatus(form, message);
  }
}

function focusField(form: HTMLFormElement, name: string) {
  const el = form.querySelector<HTMLElement>(`#${CSS.escape(name)}`);
  if (!el) return;
  const focusable = el instanceof HTMLFieldSetElement ? el.querySelector<HTMLElement>('input, select, textarea') : el;
  (focusable ?? el).focus();
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function resetTurnstile(form: HTMLFormElement) {
  const widget = form.querySelector<HTMLElement>('.cf-turnstile');
  try {
    if (widget && window.turnstile) window.turnstile.reset(widget);
  } catch {
    /* widget not rendered yet */
  }
}

export function enhanceForm(form: HTMLFormElement, options: FormOptions = {}) {
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    const data = serialize(form);

    const clientErrors = options.validate?.(form, data) ?? {};
    if (!data['cf-turnstile-response']) {
      clientErrors['turnstile'] = 'Please wait for the spam check to finish, then send again.';
    }
    if (Object.keys(clientErrors).length) {
      showErrors(form, clientErrors);
      return;
    }

    submit?.setAttribute('disabled', '');
    form.setAttribute('aria-busy', 'true');
    setStatus(form, 'Sending…');

    let reply: ServerReply;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
        credentials: 'same-origin',
      });
      reply = (await res.json().catch(() => ({ ok: false, message: `Something went wrong (error ${res.status}).` }))) as ServerReply;
    } catch {
      reply = { ok: false, message: 'We could not reach the server. Check your connection and try again.' };
    } finally {
      submit?.removeAttribute('disabled');
      form.removeAttribute('aria-busy');
    }

    if (reply.ok) {
      setStatus(form, '');
      options.onSuccess?.(reply, form);
      const success = document.querySelector<HTMLElement>(`[data-success-for="${form.id}"]`);
      if (success) {
        form.hidden = true;
        success.hidden = false;
        success.focus();
      }
      return;
    }

    resetTurnstile(form);
    if (reply.errors && Object.keys(reply.errors).length) showErrors(form, reply.errors, reply.message);
    else showErrors(form, { form: reply.message || 'Something went wrong. Please try again.' }, 'We could not send this.');
  });
}
