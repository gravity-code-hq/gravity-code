export const POWER_JOB_LABEL = "com.gravity.keep-awake";
export const POWER_STATE_DIRECTORY = "/var/db/com.gravity.keep-awake";
export const POWER_PLIST_PATH = "/Library/LaunchDaemons/com.gravity.keep-awake.plist";

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

interface WatchdogOptions {
  leasePath: string;
  ownerPid: number;
  ownerStartedAt: string;
  deadline: number;
  token: string;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

interface WatchdogEnvironment {
  stateDirectory: string;
  plistPath: string;
  commandPath: string;
}

const SYSTEM_ENVIRONMENT: WatchdogEnvironment = {
  stateDirectory: POWER_STATE_DIRECTORY,
  plistPath: POWER_PLIST_PATH,
  commandPath: "/usr/bin:/bin:/usr/sbin:/sbin",
};

export function buildWatchdogScript(
  options: WatchdogOptions,
  environment = SYSTEM_ENVIRONMENT,
): string {
  return String.raw`
set -eu
PATH=${shellQuote(environment.commandPath)}
LC_ALL=C
export PATH LC_ALL
state=${shellQuote(environment.stateDirectory)}
lease=${shellQuote(options.leasePath)}
owner=${options.ownerPid}
started=${shellQuote(options.ownerStartedAt)}
deadline=${options.deadline}
token=${shellQuote(options.token)}

sleep_disabled() {
  settings=$(pmset -g) || return 1
  printf '%s' "$settings" | awk 'BEGIN { value=0 } /SleepDisabled/ { value=$2 } END { print value }'
}

lease_valid() {
  [ -d "$lease" ] || return 1
  [ "$(ps -p "$owner" -o lstart= | sed 's/[[:space:]]*$//')" = "$started" ] || return 1
  now=$(date +%s)
  modified=$(stat -f %m "$lease") || return 1
  [ "$now" -lt "$deadline" ] || return 1
  [ "$((now - modified))" -lt 30 ] || return 1
  battery=$(pmset -g batt) || return 1
  case "$battery" in
    *"Battery Power"*)
      charge=$(printf '%s' "$battery" | sed -n 's/.*[[:space:]]\([0-9][0-9]*\)%;.*/\1/p' | head -1)
      case "$charge" in ''|*[!0-9]*) return 1 ;; esac
      [ "$charge" -gt 20 ] || return 1
      ;;
  esac
}

restore() {
  trap '' TERM INT HUP
  # Keep the recovery job installed until restoration is confirmed.
  pmset -a disablesleep 0 || exit 1
  [ "$(sleep_disabled)" = 0 ] || exit 1
  rm -f ${shellQuote(environment.plistPath)}
  rm -f "$state/armed" "$state/active"
  rmdir "$state"
  trap - TERM INT HUP
  launchctl bootout system/${POWER_JOB_LABEL} || true
  exit 0
}
trap restore TERM INT HUP

# A restarted helper must restore, never renew a previous session.
if [ ! -f "$state/armed" ] || ! lease_valid; then restore; fi
rm "$state/armed"
pmset -a disablesleep 1 || restore
[ "$(sleep_disabled)" = 1 ] || restore
printf '%s' "$token" > "$state/active"
while lease_valid; do sleep 2; done
restore
`;
}

export function buildPowerInstallScript(options: WatchdogOptions): string {
  const watchdog = buildWatchdogScript(options);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${POWER_JOB_LABEL}</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>${xmlEscape(watchdog)}</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>2</integer>
</dict></plist>`;
  return String.raw`
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
LC_ALL=C
export PATH LC_ALL
umask 022
if [ -e ${shellQuote(POWER_PLIST_PATH)} ] || launchctl print system/${POWER_JOB_LABEL} >/dev/null 2>&1; then
  if ! launchctl print system/${POWER_JOB_LABEL} >/dev/null 2>&1; then
    launchctl bootstrap system ${shellQuote(POWER_PLIST_PATH)}
  fi
  echo 'Gravity sleep recovery is still running. Try again shortly.' >&2
  exit 1
fi
settings=$(pmset -g)
disabled=$(printf '%s' "$settings" | awk 'BEGIN { value=0 } /SleepDisabled/ { value=$2 } END { print value }')
if [ "$disabled" != 0 ]; then
  echo 'Sleep is already disabled outside Gravity, or its state could not be read.' >&2
  exit 1
fi
mkdir ${shellQuote(POWER_STATE_DIRECTORY)} || { echo 'Another Gravity power session needs recovery.' >&2; exit 1; }
cleanup_install() {
  if ! launchctl print system/${POWER_JOB_LABEL} >/dev/null 2>&1; then
    rm -f ${shellQuote(POWER_PLIST_PATH)} ${shellQuote(`${POWER_STATE_DIRECTORY}/armed`)} ${shellQuote(`${POWER_STATE_DIRECTORY}/job.plist`)}
    rmdir ${shellQuote(POWER_STATE_DIRECTORY)}
  fi
}
trap cleanup_install EXIT
touch ${shellQuote(`${POWER_STATE_DIRECTORY}/armed`)}
printf '%s' ${shellQuote(plist)} > ${shellQuote(`${POWER_STATE_DIRECTORY}/job.plist`)}
chown root:wheel ${shellQuote(`${POWER_STATE_DIRECTORY}/job.plist`)}
chmod 644 ${shellQuote(`${POWER_STATE_DIRECTORY}/job.plist`)}
mv ${shellQuote(`${POWER_STATE_DIRECTORY}/job.plist`)} ${shellQuote(POWER_PLIST_PATH)}
launchctl bootstrap system ${shellQuote(POWER_PLIST_PATH)}
`;
}
