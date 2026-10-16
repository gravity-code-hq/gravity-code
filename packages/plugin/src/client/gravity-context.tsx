import type { GravityApi } from "@gravity/client";
import { createContext, useContext, type ReactNode } from "react";

const GravityApiContext = createContext<GravityApi | null>(null);

export function useGravityContextValue(): GravityApi | null {
  return useContext(GravityApiContext);
}

export function GravityApiProvider({
  children,
  gravity,
}: {
  children: ReactNode;
  gravity: GravityApi;
}) {
  return <GravityApiContext.Provider value={gravity}>{children}</GravityApiContext.Provider>;
}

export function useGravity(): GravityApi {
  const gravity = useGravityContextValue();
  if (!gravity) throw new Error("useGravity must run inside a contributed plugin surface");
  return gravity;
}
