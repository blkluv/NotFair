"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Briefcase, Megaphone, Search, type LucideIcon } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { RunningDot } from "@/components/running-dot";
import type { AgentTemplateKey } from "@/server/agent-templates";

type AgentNavEntry = {
  /** Stable key for React, e.g. the agent_id. */
  key: string;
  slug: string;
  display_name: string;
  description?: string;
  /** Filled for template agents; undefined for cloned/custom ones. */
  template_key?: AgentTemplateKey;
};

type Props = {
  agents: AgentNavEntry[];
  /**
   * agent_id → in-flight task count. Drives the live-dot + count badge on
   * each row. Stale by up to the server-component refresh interval; that's
   * fine for an "I have work" hint.
   */
  inFlightCounts?: Record<string, number>;
};

const TEMPLATE_ICONS: Record<AgentTemplateKey, LucideIcon> = {
  cmo: Briefcase,
  google_ads: Megaphone,
  seo: Search,
};

export function AgentNav({ agents, inFlightCounts = {} }: Props) {
  const pathname = usePathname();

  return (
    <SidebarMenu>
      {agents.map((a) => {
        // Specialists land on Tasks; CMO lands on Chat. The CMO doesn't own
        // tasks (it delegates them) so Tasks would be empty for it.
        const href =
          a.template_key === "cmo"
            ? `/agents/${a.slug}/chat`
            : `/agents/${a.slug}/tasks`;
        const agentBase = `/agents/${a.slug}`;
        const isActive =
          pathname === agentBase || pathname?.startsWith(`${agentBase}/`);
        const Icon = a.template_key ? TEMPLATE_ICONS[a.template_key] ?? Bot : Bot;
        const liveCount = inFlightCounts[a.key] ?? 0;
        return (
          <SidebarMenuItem key={a.key}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link href={href}>
                <Icon />
                <span>{a.display_name}</span>
                {liveCount > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1.5">
                    <RunningDot size="sm" aria-label={`${liveCount} running`} />
                    <span className="text-[10px] font-medium tabular-nums text-sky-600 dark:text-sky-400">
                      {liveCount}
                    </span>
                  </span>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
