"use server";

import { revalidatePath } from "next/cache";
import { resolveApproval } from "@/server/db/approvals";

export async function approveAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = resolveApproval(id, "approved");
  if (!result) return { ok: false, error: "Approval not found or already resolved." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const result = resolveApproval(id, "rejected");
  if (!result) return { ok: false, error: "Approval not found or already resolved." };
  revalidatePath("/", "layout");
  return { ok: true };
}
