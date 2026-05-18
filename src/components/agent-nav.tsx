"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Briefcase, Megaphone, Search, type LucideIcon } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
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
};

const TEMPLATE_ICONS: Record<AgentTemplateKey, LucideIcon> = {
  cmo: Briefcase,
  google_ads: Megaphone,
  seo: Search,
};

export function AgentNav({ agents }: Props) {
  const pathname = usePathname();

  return (
    <SidebarMenu>
      {agents.map((a) => {
        const href = `/agents/${a.slug}/chat`;
        const agentBase = `/agents/${a.slug}`;
        const isActive =
          pathname === agentBase || pathname?.startsWith(`${agentBase}/`);
        const Icon = a.template_key ? TEMPLATE_ICONS[a.template_key] ?? Bot : Bot;
        return (
          <SidebarMenuItem key={a.key}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link href={href}>
                <Icon />
                <span>{a.display_name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
