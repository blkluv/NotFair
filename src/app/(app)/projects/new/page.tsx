import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProjectAction } from "@/server/actions/projects";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>
            A project groups the OpenClaw agents and crons your CMO will manage.
            Pick a name now; it&rsquo;s editable later. The slug (used in agent
            names) is set once and immutable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createProjectAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display_name">Project name</Label>
              <Input
                id="display_name"
                name="display_name"
                required
                autoFocus
                placeholder="Acme Q4 launch"
                maxLength={80}
              />
            </div>
            <Button type="submit" className="w-full">
              Create project
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
