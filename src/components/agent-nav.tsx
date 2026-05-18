"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Megaphone, Search, type LucideIcon } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { AgentTemplate, AgentTemplateKey } from "@/server/agent-templates";

type AgentNavEntry = {
  key: AgentTemplate["key"];
  slug: string;
  display_name: string;
  description: string;
};

type Props = {
  agents: AgentNavEntry[];
};

const ICONS: Record<AgentTemplateKey, LucideIcon> = {
  cmo: Briefcase,
  google_ads: Megaphone,
  seo: Search,
};

export function AgentNav({ agents }: Props) {
  const pathname = usePathname();

  return (
    <SidebarMenu>
      {agents.map((a) => {
        const href = `/chat/${a.slug}`;
        const isActive = pathname === href;
        const Icon = ICONS[a.key] ?? Briefcase;
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
