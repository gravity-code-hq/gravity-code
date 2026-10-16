import path from "node:path";

import { resolveGravityHome } from "../../../gravity-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveGravityHome(env), OPENCODE_HOME_DIRNAME);
}
