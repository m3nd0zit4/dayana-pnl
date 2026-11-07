"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isAgentId, type AgentId } from "@/agent/lib/catalog";

export const AGENT_MESSAGE_PARAM = "agentMessage";

/** What `GET /api/admin/agent/messages/<key>` answers: the message the assistant started a conversation with. */
export type AgentMessageSeed = { key: string; agent: AgentId; title: string; message: string; createdAt: string };

const parseSeed = (raw: unknown, key: string): AgentMessageSeed | null => {
  if (!raw || typeof raw !== "object") return null;
  const s = (raw as { seed?: Record<string, unknown> }).seed;
  if (!s || typeof s.message !== "string" || !s.message.trim()) return null;
  return {
    key,
    agent: isAgentId(s.agent) ? s.agent : "auto",
    title: typeof s.title === "string" ? s.title : "",
    message: s.message,
    createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
  };
};

/**
 * Watches `?agentMessage=<key>` on any /admin page (first load or client
 * navigation, e.g. from the bell): fetches the message, hands it to the panel,
 * then drops the param from the URL with `router.replace`, keeping the rest of
 * the query. Renders nothing. Needs a Suspense boundary (`useSearchParams`).
 */
const AgentMessageParam = ({
  onSeed,
  onMissing,
}: {
  onSeed: (seed: AgentMessageSeed) => void;
  onMissing: () => void;
}) => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const key = searchParams.get(AGENT_MESSAGE_PARAM);
  // Read when the fetch ends, not when it started: she may have navigated meanwhile.
  const latest = useRef({ pathname, searchParams, onSeed, onMissing });
  useEffect(() => {
    latest.current = { pathname, searchParams, onSeed, onMissing };
  });

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();

    const dropParam = () => {
      const { pathname: path, searchParams: params } = latest.current;
      if (params.get(AGENT_MESSAGE_PARAM) !== key) return;
      const rest = new URLSearchParams(params.toString());
      rest.delete(AGENT_MESSAGE_PARAM);
      const query = rest.toString();
      router.replace(`${path}${query ? `?${query}` : ""}${window.location.hash}`, { scroll: false });
    };

    void (async () => {
      let seed: AgentMessageSeed | null = null;
      try {
        const res = await fetch(`/api/admin/agent/messages/${encodeURIComponent(key)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        seed = res.ok ? parseSeed(await res.json(), key) : null;
      } catch {
        if (controller.signal.aborted) return;
      }
      // A re-run (Strict Mode, or the param changed mid-fetch) owns the outcome.
      if (controller.signal.aborted) return;
      if (seed) latest.current.onSeed(seed);
      else latest.current.onMissing();
      dropParam();
    })();

    return () => controller.abort();
  }, [key, router]);

  return null;
};

export default AgentMessageParam;
