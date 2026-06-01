import { Badge } from "@/components/ui/badge";
import type { SkillEntry } from "@/server/agents/skills";

type Props = {
  skills: SkillEntry[];
};

export function SkillsList({ skills }: Props) {
  if (skills.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
        No skills wired into this agent yet.
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {skills.map((s) => (
        <li key={s.key} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{s.name}</span>
              <Badge variant="secondary" className="h-4 px-1 text-[9px] uppercase tracking-wide">
                {s.scope}
              </Badge>
            </div>
            {s.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
            )}
            {s.source && (
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
                {s.source}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
