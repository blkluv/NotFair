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
  SidebarTrigger,
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
import { listProjectAgents } from "@/server/agent-meta";
import { ProjectSwitcher } from "./project-switcher";
import { CostMeter } from "./cost-meter";
import { AgentNav } from "./agent-nav";
import { CreateAgentButton } from "./create-agent-button";
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
  const agentEntries = active ? await listProjectAgents(active.slug) : [];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* Project switcher + collapse toggle. Toggle stays visible in
            icon-collapsed mode so the user can always re-expand the rail. */}
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <SidebarMenu>
              <SidebarMenuItem>
                <ProjectSwitcher
                  projects={projects}
                  activeSlug={active?.slug ?? null}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </div>
          <SidebarTrigger className="shrink-0" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {active && (
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between">
              <span>Agents</span>
              <CreateAgentButton projectSlug={active.slug} />
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <AgentNav
                agents={agentEntries.map((a) => ({
                  key: a.agent_id,
                  slug: a.slug,
                  display_name: a.display_name,
                  description: a.description,
                  template_key: a.template_key,
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
