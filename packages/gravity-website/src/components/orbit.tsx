import { GravityMark } from "./brand";
import { ClaudeLogo, CodexLogo, CursorLogo, GitHubLogo, LinearLogo } from "./provider-logos";

export function Orbit({ compact = false }: { compact?: boolean }) {
  const className = compact ? "orbit-art orbit-compact" : "orbit-art";
  return (
    <div className={className} aria-hidden="true">
      <div className="orbit-axis orbit-axis-x" />
      <div className="orbit-axis orbit-axis-y" />
      <div className="orbit-ring orbit-ring-outer" />
      <div className="orbit-ring orbit-ring-middle" />
      <div className="orbit-ring orbit-ring-inner" />
      <div className="orbit-core">
        <GravityMark />
      </div>
      <span className="orbit-satellite satellite-claude">
        <ClaudeLogo />
      </span>
      <span className="orbit-satellite satellite-codex">
        <CodexLogo />
      </span>
      <span className="orbit-satellite satellite-cursor">
        <CursorLogo />
      </span>
      <span className="orbit-satellite satellite-linear">
        <LinearLogo />
      </span>
      <span className="orbit-satellite satellite-github">
        <GitHubLogo />
      </span>
      <span className="orbit-tiny-dot" />
      {!compact && <span className="orbit-caption">LESS FRICTION. MORE MOMENTUM.</span>}
    </div>
  );
}
