"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Maximize2, Minimize2, Send, ChevronDown, Bot, Plus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@multica/ui/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import { agentListOptions, memberListOptions } from "@multica/core/workspace/queries";
import { canAssignAgent } from "@multica/views/issues/components";
import { api } from "@/platform/api";
import { chatSessionsOptions, chatMessagesOptions, chatKeys } from "@/core/chat/queries";
import { useCreateChatSession } from "@/core/chat/mutations";
import { useChatStore } from "../store";
import { ChatMessageList } from "./chat-message-list";
import { ChatInput } from "./chat-input";
import { useWS } from "@multica/core/realtime";
import type { TaskMessagePayload, ChatDonePayload, Agent, ChatMessage } from "@multica/core/types";

export function ChatWindow() {
  const wsId = useWorkspaceId();
  const isOpen = useChatStore((s) => s.isOpen);
  const isFullscreen = useChatStore((s) => s.isFullscreen);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const pendingTaskId = useChatStore((s) => s.pendingTaskId);
  const timelineItems = useChatStore((s) => s.timelineItems);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const setOpen = useChatStore((s) => s.setOpen);
  const toggleFullscreen = useChatStore((s) => s.toggleFullscreen);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setPendingTask = useChatStore((s) => s.setPendingTask);
  const addTimelineItem = useChatStore((s) => s.addTimelineItem);
  const clearTimeline = useChatStore((s) => s.clearTimeline);
  const setSelectedAgentId = useChatStore((s) => s.setSelectedAgentId);

  const user = useAuthStore((s) => s.user);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: sessions = [] } = useQuery(chatSessionsOptions(wsId));
  const { data: rawMessages } = useQuery(
    chatMessagesOptions(activeSessionId ?? ""),
  );
  // When no active session, always show empty — don't use stale cache
  const messages = activeSessionId ? rawMessages ?? [] : [];

  const qc = useQueryClient();
  const createSession = useCreateChatSession();

  const currentMember = members.find((m) => m.user_id === user?.id);
  const memberRole = currentMember?.role;
  const availableAgents = agents.filter(
    (a) => !a.archived_at && canAssignAgent(a, user?.id, memberRole),
  );

  // Resolve selected agent: stored preference → first available
  const activeAgent =
    availableAgents.find((a) => a.id === selectedAgentId) ??
    availableAgents[0] ??
    null;

  // Auto-restore most recent active session from server (only once on mount)
  const didRestoreRef = useRef(false);
  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    if (activeSessionId || sessions.length === 0) return;
    const latest = sessions.find((s) => s.status === "active");
    if (latest) {
      setActiveSession(latest.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when sessions load
  }, [sessions]);

  // Use ref for pendingTaskId so WS handlers always see the latest value
  // without needing to re-subscribe on every change.
  const pendingTaskRef = useRef<string | null>(pendingTaskId);
  pendingTaskRef.current = pendingTaskId;

  const { subscribe } = useWS();

  useEffect(() => {
    const unsubMessage = subscribe("task:message", (payload) => {
      const p = payload as TaskMessagePayload;
      if (!pendingTaskRef.current || p.task_id !== pendingTaskRef.current) return;
      addTimelineItem({
        seq: p.seq,
        type: p.type,
        tool: p.tool,
        content: p.content,
        input: p.input,
        output: p.output,
      });
    });

    const unsubDone = subscribe("chat:done", (payload) => {
      const p = payload as ChatDonePayload;
      if (!pendingTaskRef.current || p.task_id !== pendingTaskRef.current) return;
      const activeSessionId = useChatStore.getState().activeSessionId;
      if (activeSessionId) {
        qc.invalidateQueries({
          queryKey: chatKeys.messages(activeSessionId),
        });
      }
      clearTimeline();
      setPendingTask(null);
    });

    const unsubCompleted = subscribe("task:completed", (payload) => {
      const p = payload as { task_id: string };
      if (!pendingTaskRef.current || p.task_id !== pendingTaskRef.current) return;
      const activeSessionId = useChatStore.getState().activeSessionId;
      if (activeSessionId) {
        qc.invalidateQueries({
          queryKey: chatKeys.messages(activeSessionId),
        });
      }
      clearTimeline();
      setPendingTask(null);
    });

    const unsubFailed = subscribe("task:failed", (payload) => {
      const p = payload as { task_id: string };
      if (!pendingTaskRef.current || p.task_id !== pendingTaskRef.current) return;
      clearTimeline();
      setPendingTask(null);
    });

    return () => {
      unsubMessage();
      unsubDone();
      unsubCompleted();
      unsubFailed();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs + stable store actions, subscribe once
  }, [subscribe, addTimelineItem, clearTimeline, setPendingTask, qc]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeAgent) return;

      let sessionId = activeSessionId;

      if (!sessionId) {
        const session = await createSession.mutateAsync({
          agent_id: activeAgent.id,
          title: content.slice(0, 50),
        });
        sessionId = session.id;
        setActiveSession(sessionId);
      }

      // Optimistic: show user message immediately.
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        chat_session_id: sessionId,
        role: "user",
        content,
        task_id: null,
        created_at: new Date().toISOString(),
      };
      qc.setQueryData<ChatMessage[]>(
        chatKeys.messages(sessionId),
        (old) => (old ? [...old, optimistic] : [optimistic]),
      );

      const result = await api.sendChatMessage(sessionId, content);
      setPendingTask(result.task_id);
      qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
    },
    [
      activeSessionId,
      activeAgent,
      createSession,
      setActiveSession,
      setPendingTask,
      qc,
    ],
  );

  const handleStop = useCallback(async () => {
    if (!pendingTaskId) return;
    try {
      await api.cancelTaskById(pendingTaskId);
    } catch {
      // Task may already be completed
    }
    if (activeSessionId) {
      qc.invalidateQueries({ queryKey: chatKeys.messages(activeSessionId) });
    }
    clearTimeline();
    setPendingTask(null);
  }, [pendingTaskId, activeSessionId, clearTimeline, setPendingTask, qc]);

  const handleSelectAgent = useCallback(
    (agent: Agent) => {
      setSelectedAgentId(agent.id);
      // Reset session when switching agent
      setActiveSession(null);
    },
    [setSelectedAgentId, setActiveSession],
  );

  if (!isOpen) return null;

  const hasMessages = messages.length > 0 || timelineItems.length > 0;

  const containerClass = isFullscreen
    ? "fixed inset-y-0 right-0 z-50 flex flex-col w-[50%] border-l bg-background shadow-2xl"
    : "fixed bottom-4 right-4 z-50 flex flex-col w-[420px] h-[600px] rounded-xl border bg-background shadow-2xl overflow-hidden";

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <AgentSelector
          agents={availableAgents}
          activeAgent={activeAgent}
          onSelect={handleSelectAgent}
        />
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              setActiveSession(null);
              clearTimeline();
              setPendingTask(null);
            }}
            title="New chat"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Minimize"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Minus className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Messages or Empty State */}
      {hasMessages ? (
        <ChatMessageList
          messages={messages}
          agent={activeAgent}
          timelineItems={timelineItems}
          isWaiting={!!pendingTaskId}
        />
      ) : (
        <EmptyState agentName={activeAgent?.name} />
      )}

      {/* Input */}
      <ChatInput onSend={handleSend} onStop={handleStop} isRunning={!!pendingTaskId} />
    </div>
  );
}

function AgentSelector({
  agents,
  activeAgent,
  onSelect,
}: {
  agents: Agent[];
  activeAgent: Agent | null;
  onSelect: (agent: Agent) => void;
}) {
  if (!activeAgent) {
    return <span className="text-sm text-muted-foreground">No agents</span>;
  }

  if (agents.length <= 1) {
    return (
      <div className="flex items-center gap-2">
        <AgentAvatarSmall agent={activeAgent} />
        <span className="text-sm font-medium">{activeAgent.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-1.5 py-1 -ml-1.5 transition-colors hover:bg-accent">
        <AgentAvatarSmall agent={activeAgent} />
        <span className="text-sm font-medium">{activeAgent.name}</span>
        <ChevronDown className="size-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onClick={() => onSelect(agent)}
            className="flex items-center gap-2"
          >
            <AgentAvatarSmall agent={agent} />
            <span>{agent.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentAvatarSmall({ agent }: { agent: Agent }) {
  return (
    <Avatar className="size-5">
      {agent.avatar_url && <AvatarImage src={agent.avatar_url} />}
      <AvatarFallback className="bg-purple-100 text-purple-700 text-[10px]">
        <Bot className="size-3" />
      </AvatarFallback>
    </Avatar>
  );
}

function EmptyState({ agentName }: { agentName?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
      <Send className="size-8 text-muted-foreground/50" />
      <div className="text-center">
        <h3 className="text-base font-semibold">Welcome to Multica</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {agentName
            ? `Chat with ${agentName} or ask anything`
            : "Ask anything or tell Multica what you need"}
        </p>
      </div>
    </div>
  );
}
