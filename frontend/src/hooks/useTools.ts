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
  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data?: CreateEstimateFromToolRequest }) =>
      toolService.createEstimateFromSession(sessionId, data),
    onSuccess: (result) => {
      message.success(`Estimate ${result.estimateNumber} created`);
      navigate(`/app/estimates/${result.estimateId}`);
    },
    onError: () => {
      message.error('Failed to create estimate');
    },
  });
}
