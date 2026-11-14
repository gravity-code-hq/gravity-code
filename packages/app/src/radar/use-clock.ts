import { useEffect, useMemo, useState } from "react";
import { subscribeToRelativeTimeTick } from "@/utils/relative-time-ticker";

/**
 * "Last check 4m ago" ages between fetches, so a radar surface re-reads the
 * clock on the shared minute tick and whenever `freshData` changes identity.
 */
export function useRadarClock(freshData: unknown): number {
  const [tick, setTick] = useState(0);
  useEffect(
    () => subscribeToRelativeTimeTick("minute", () => setTick((current) => current + 1)),
    [],
  );
  return useMemo(() => {
    void tick;
    void freshData;
    return Date.now();
  }, [tick, freshData]);
}
