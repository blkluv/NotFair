"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Step = {
  id: "scrape" | "voice" | "icp" | "plan";
  label: string;
};

const STEPS: Step[] = [
  { id: "scrape", label: "Scraping your site" },
  { id: "voice", label: "Deriving brand voice fingerprint" },
  { id: "icp", label: "Drafting ICP hypothesis" },
  { id: "plan", label: "Building your 30-day plan" },
];

type StepState = "pending" | "running" | "done" | "error";

export function OnboardingFlow() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [states, setStates] = useState<Record<Step["id"], StepState>>({
    scrape: "pending",
    voice: "pending",
    icp: "pending",
    plan: "pending",
  });
  const [active, setActive] = useState(false);
  const [pending, start] = useTransition();

  async function run() {
    if (!url.trim()) {
      toast.error("Enter your site URL first.");
      return;
    }
    setActive(true);

    // V1: stub the per-step work with timed transitions so the UX is real even
    // before the actual scraping/derivation MCP tools are wired up.
    for (const step of STEPS) {
      setStates((s) => ({ ...s, [step.id]: "running" }));
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));
      setStates((s) => ({ ...s, [step.id]: "done" }));
    }
  }

  function done() {
    start(() => {
      router.push("/");
      router.refresh();
    });
  }

  const allDone = STEPS.every((s) => states[s.id] === "done");

  return (
    <div className="mx-auto max-w-2xl space-y-6 pt-8">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Let&rsquo;s set up your CMO.</h1>
        <p className="text-sm text-muted-foreground">
          Paste your site URL. The CMO scrapes it, learns your voice, drafts an ICP,
          and proposes a 30-day plan.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Site URL</CardTitle>
          <CardDescription>This is the only thing you need to provide right now.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              placeholder="https://yourcompany.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={active}
              autoFocus
            />
          </div>
          {!active && (
            <Button onClick={() => void run()} disabled={!url.trim()}>
              Go
            </Button>
          )}
        </CardContent>
      </Card>

      {active && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Building your plan</CardTitle>
            <CardDescription>This usually takes about 30 seconds.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {STEPS.map((step) => (
                <li key={step.id} className="flex items-center gap-3 text-sm">
                  <StepIcon state={states[step.id]} />
                  <span
                    className={cn(
                      states[step.id] === "running" && "font-medium",
                      states[step.id] === "pending" && "text-muted-foreground",
                      states[step.id] === "error" && "text-destructive",
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {allDone && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your 30-day plan is ready</CardTitle>
            <CardDescription>
              In V1, the plan is a placeholder — wire up real scraping + LLM steps after
              shipping the core UI.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="space-y-1 text-sm">
              <li>• Week 1: Google Ads bid optimization on 12 keywords</li>
              <li>• Week 1: SEO audit + 3 content proposals</li>
              <li>• Week 2: Cold email sequence to 50 warm leads</li>
              <li>• Week 3-4: Iterate on what's working</li>
            </ul>
            <Button onClick={done} disabled={pending}>
              Take me to the project
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (state === "running") return <Loader2 className="size-4 animate-spin" />;
  if (state === "error") return <AlertCircle className="size-4 text-destructive" />;
  return <div className="size-4 rounded-full border" />;
}
