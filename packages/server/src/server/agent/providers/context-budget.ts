import { z } from "zod";
import type { AgentFeatureSelect } from "../agent-sdk-types.js";

export const CONTEXT_BUDGET_FEATURE_ID = "context_budget";

const ContextBudgetSchema = z.enum(["auto", "100000", "200000", "250000", "500000", "1000000"]);

export function contextBudgetTokens(value: unknown): number | null {
  const budget = ContextBudgetSchema.parse(value ?? "auto");
  return budget === "auto" ? null : Number(budget);
}

export function buildContextBudgetFeature(value: unknown): AgentFeatureSelect {
  const budget = ContextBudgetSchema.parse(value ?? "auto");
  return {
    type: "select",
    id: CONTEXT_BUDGET_FEATURE_ID,
    label: "Context budget",
    description: "Budget before automatic compaction. The model's context limit still applies.",
    tooltip: "Context budget for subsequent turns",
    icon: "database",
    value: budget,
    options: [
      { id: "auto", label: "Auto" },
      { id: "100000", label: "100K" },
      { id: "200000", label: "200K" },
      { id: "250000", label: "250K" },
      { id: "500000", label: "500K" },
      { id: "1000000", label: "1M" },
    ],
  };
}
