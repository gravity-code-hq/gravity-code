import type { Command } from "commander";

const resolutionHelp =
  "\nHub origin precedence: command origin/--hub, GRAVITY_HUB_URL, active stored login, then https://hub.gravity.example.\nCredential precedence: --api-key, GRAVITY_HUB_API_KEY, then a stored login for the exact resolved origin.\n";

export function addHubResolutionHelp(command: Command): Command {
  return command.addHelpText("after", resolutionHelp);
}
