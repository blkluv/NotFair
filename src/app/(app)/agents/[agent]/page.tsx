import { redirect } from "next/navigation";

export default async function AgentIndexPage({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent } = await params;
  redirect(`/agents/${agent}/chat`);
}
