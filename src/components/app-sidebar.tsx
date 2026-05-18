import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Home,
  CheckCircle2,
  ListChecks,
  Clock,
  Plug,
  Settings,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { listProjects } from "@/server/db/projects";
import { getActiveProject } from "@/server/active-project";
import { pendingApprovalCount } from "@/server/db/approvals";
import { TEMPLATES, urlSlugForTemplate, type AgentTemplateKey } from "@/server/agent-templates";
import { ProjectSwitcher } from "./project-switcher";
import { CostMeter } from "./cost-meter";
import { AgentNav } from "./agent-nav";
import { Badge } from "@/components/ui/badge";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2, badge: true },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/crons", label: "Crons", icon: Clock },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/connections", label: "Connections", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export async function AppSidebar() {
  const projects = listProjects();
  const active = await getActiveProject();
  const approvalsBadge = active ? pendingApprovalCount(active.slug) : 0;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <ProjectSwitcher
              projects={projects}
              activeSlug={active?.slug ?? null}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {active && (
          <SidebarGroup>
            <SidebarGroupLabel>Agents</SidebarGroupLabel>
            <SidebarGroupContent>
              <AgentNav
                agents={TEMPLATES.map((t) => ({
                  key: t.key,
                  slug: urlSlugForTemplate(t.key as AgentTemplateKey),
                  display_name: t.display_name,
                  description: t.description,
                }))}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Project</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild>
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                      {item.badge && approvalsBadge > 0 && (
                        <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                          {approvalsBadge}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        {active && <CostMeter project_slug={active.slug} />}
      </SidebarFooter>
    </Sidebar>
  );
}
