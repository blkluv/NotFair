import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { getProject } from "@/server/db/projects";
import { MCP_CATALOG, storedMcpKey } from "@/server/mcp-catalog";
import { getMcpStatus } from "@/server/mcp-state";
import { McpCard } from "@/components/mcp-card";
import { McpFlashBanner } from "@/components/mcp-flash-banner";

type Search = { mcp_connected?: string; mcp_error?: string };

export default async function ConnectionsPage({
  searchParams,
  params,
}: {
  searchParams: Promise<Search>;
  params: Promise<{ project: string }>;
}) {
  const { project: slug } = await params;
  const project = getProject(slug);
  const { mcp_connected, mcp_error } = await searchParams;
  if (!project || project.archived_at) notFound();

  // Status probes happen in parallel — each has its own 2s timeout so a
  // flaky upstream doesn't gate the whole page.
  const statuses = await Promise.all(
    MCP_CATALOG.map((s) => getMcpStatus(storedMcpKey(project.slug, s.key))),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Project <span className="font-mono">{project.slug}</span> · MCP servers
          configured here are shared by every agent in this project. Each project
          gets its own OpenClaw key (and its own bearer token), so connecting
          here doesn&rsquo;t touch other projects&rsquo; setups.
        </p>
      </header>

      <McpFlashBanner connected={mcp_connected} error={mcp_error} />

      {MCP_CATALOG.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No MCP servers in the catalog yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {MCP_CATALOG.map((spec, i) => (
            <McpCard key={spec.key} spec={spec} status={statuses[i]} />
          ))}
        </div>
      )}
    </div>
  );
}
