export function createElectronSpawnOptions({
  env,
  colorEnv,
  expoDevUrl,
  devBuildLabel,
  platform = process.platform,
}) {
  const electronEnv = {
    ...env,
    ...colorEnv,
    EXPO_DEV_URL: expoDevUrl,
    ...(devBuildLabel ? { EXPO_PUBLIC_GRAVITY_DEV_BUILD_LABEL: devBuildLabel } : {}),
  };
  // Homebrew image libraries can crash macOS ImageIO when Electron renders emoji.
  if (platform === "darwin") {
    delete electronEnv.DYLD_LIBRARY_PATH;
  }

  return {
    // Electron must stay in the runner's process group. Gravity workspace scripts
    // own the terminal process group, so detaching Electron lets it survive a
    // service stop with broken stdout/stderr pipes and block the next launch.
    detached: false,
    env: electronEnv,
  };
}

export function resolveChildKillTarget(pid, detached) {
  return detached ? -pid : pid;
}

export function registerDevRunnerShutdownSignals({ signalSource, stop }) {
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    signalSource.on(signal, () => stop("SIGTERM"));
  }
}
