/**
 * Scopit - Resume Pending Action Hook
 *
 * After a successful login/register, resumes whatever action was queued in
 * pendingActionStore before the user was routed to auth (currently just
 * claiming an anonymous packing lead). Call this right after login succeeds,
 * before the page's own default post-login navigate() — its navigation, if
 * any, should take precedence.
 *
 * Returns a function that resolves to `true` if it took over navigation
 * (caller should skip its own default redirect) or `false` if there was
 * nothing to resume (caller should proceed as normal).
 */
import { useNavigate } from 'react-router-dom';
import { App } from 'antd';
import { usePendingActionStore } from '@/stores/pendingActionStore';
import { packingLeadService } from '@/services/packingLeadService';
import { getErrorMessage } from '@/services/api';

export function useResumePendingAction() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const consumePendingAction = usePendingActionStore((s) => s.consumePendingAction);

  return async (): Promise<boolean> => {
    const action = consumePendingAction();
    if (!action) return false;

    if (action.type === 'packing-claim') {
      try {
        const { tool_session_id } = await packingLeadService.claim(action.token);
        navigate(`/app/tools/packing?sessionId=${tool_session_id}`);
      } catch (error) {
        // Route back to the estimate result page, which re-attempts the claim
        // and renders a friendly full-page message on failure (e.g. the
        // account has already used its one free estimate) — nicer than a bare
        // toast + silent dashboard bounce.
        if (action.returnPath) {
          navigate(action.returnPath);
        } else {
          message.error(getErrorMessage(error));
          navigate('/app/dashboard');
        }
      }
      return true;
    }

    return false;
  };
}

export default useResumePendingAction;
