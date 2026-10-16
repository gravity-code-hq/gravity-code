import type { ProviderCustomization } from "@gravity/protocol/provider-customizations";

export function buildCustomizationPrompt(entry: ProviderCustomization): string {
  const location = entry.file ? `${entry.file.cwd}/${entry.file.path}` : entry.name;
  return [
    `Help me improve the ${entry.kind} "${entry.name}".`,
    `Location: ${location}`,
    "Read its instructions and relevant supporting files first. Ask me what I want to improve before making changes.",
    entry.editable
      ? "After we agree on the change, update the relevant files, preserve unrelated behavior, and verify the result."
      : "This item is managed by the provider or a plugin. Do not modify its installed files. Help me create an editable personal version if appropriate.",
  ].join("\n\n");
}
