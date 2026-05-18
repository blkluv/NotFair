import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plug } from "lucide-react";
import { getActiveProject } from "@/server/active-project";
import { listOAuthTokens } from "@/server/db/oauth";
import type { OAuthProvider } from "@/types";

const PROVIDERS: Array<{
  id: OAuthProvider;
  label: string;
  description: string;
}> = [
  {
    id: "google_ads",
    label: "Google Ads",
    description: "OAuth for the Google Ads agent. Required for bid/budget/keyword automation.",
  },
  {
    id: "gsc",
    label: "Google Search Console",
    description: "OAuth for the SEO agent. Required for ranking + content data.",
  },
];

export default async function ConnectionsPage() {
  const project = await getActiveProject();
  if (!project) {
    return (
      <div className="mx-auto max-w-md pt-12 text-sm text-muted-foreground">
        Select a project to manage its connections.
      </div>
    );
  }

  const tokens = listOAuthTokens(project.slug);
  const tokensByProvider = new Map<OAuthProvider, number>();
  for (const t of tokens) {
    tokensByProvider.set(t.provider, (tokensByProvider.get(t.provider) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Project <span className="font-mono">{project.slug}</span> · OAuth tokens are
          encrypted with your OS keychain master key and stored locally.
        </p>
      </header>

      <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const connected = (tokensByProvider.get(p.id) ?? 0) > 0;
          return (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Plug className="size-4" />
                    {p.label}
                    {connected && (
                      <Badge variant="secondary" className="text-[10px]">
                        connected
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                </div>
                <Button asChild variant={connected ? "outline" : "default"} size="sm">
                  <a href={`/api/oauth/${p.id}/start?project=${project.slug}`}>
                    {connected ? "Reconnect" : "Connect"}
                  </a>
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground">
                  Status:{" "}
                  {connected
                    ? `${tokensByProvider.get(p.id)} account(s) connected`
                    : "not connected"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
