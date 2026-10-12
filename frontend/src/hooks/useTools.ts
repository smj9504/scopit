/**
 * Scopit - Tools Hooks
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { App } from 'antd';
import { toolService } from '@/services/toolService';
import type { ToolSessionCreate, ToolSessionUpdate, CreateEstimateFromToolRequest } from '@/types/tools';

export function useTools() {
  return useQuery({
    queryKey: ['tools'],
    queryFn: toolService.listTools,
    staleTime: 5 * 60 * 1000,
  });
}

export function useToolSessions(toolId?: string) {
  return useQuery({
    queryKey: ['tool-sessions', toolId],
    queryFn: () => toolService.listSessions(toolId),
  });
}

/**
 * Latest saved work across all tools, for the dashboard. The unfiltered
 * list also returns internal per-company records stored as tool sessions
 * (e.g. packing company profiles under their own tool id), so callers must
 * filter to user-facing tool ids — over-fetch a little to leave room.
 */
export function useRecentToolSessions(limit = 10) {
  return useQuery({
    queryKey: ['tool-sessions', 'recent', limit],
    queryFn: () => toolService.listSessionsPaged({ limit }),
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Saved-work count and newest item for one tool, for the Tools page footer.
 * limit=1 keeps the response tiny; the total comes from X-Total-Count.
 */
export function useToolSessionSummary(toolId: string, enabled = true) {
  return useQuery({
    queryKey: ['tool-sessions', 'summary', toolId],
    queryFn: () => toolService.listSessionsPaged({ toolId, limit: 1 }),
    enabled,
    staleTime: 60000,
  });
}

export function useToolSession(sessionId: string) {
  return useQuery({
    queryKey: ['tool-session', sessionId],
    queryFn: () => toolService.getSession(sessionId),
    enabled: !!sessionId,
  });
}

export function useCreateToolSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ToolSessionCreate) => toolService.createSession(data),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['tool-sessions', session.toolId] });
    },
  });
}

export function useUpdateToolSession(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ToolSessionUpdate) => toolService.updateSession(sessionId, data),
    onSuccess: (session) => {
      queryClient.setQueryData(['tool-session', sessionId], session);
    },
  });
}

export function useDeleteToolSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => toolService.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tool-sessions'] });
    },
  });
}

export function useCreateEstimateFromTool() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data?: CreateEstimateFromToolRequest }) =>
      toolService.createEstimateFromSession(sessionId, data),
    onSuccess: (result) => {
      // Created outside the cached estimates list, so invalidate or the new
      // row stays missing until the cache goes stale on its own.
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      message.success(`Estimate ${result.estimateNumber} created`);
      navigate(`/app/estimates/${result.estimateId}`);
    },
    onError: () => {
      message.error('Failed to create estimate');
    },
  });
}
