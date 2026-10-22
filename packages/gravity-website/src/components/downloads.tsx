import { useState } from "react";
import { ArrowDown, ArrowUpRight, Check, Command, Monitor, Terminal } from "lucide-react";
import { AppleIcon } from "./brand";
import { GravityMark } from "./gravity-mark";
import {
  type DownloadPlatform,
  detectDownloadPlatform,
  downloads,
  downloadStartedPath,
  releaseVersion,
} from "../releases";

export function useDownloadPlatform(): DownloadPlatform {
  const [platform] = useState(detectDownloadPlatform);
  return platform;
}

export function PlatformIcon({ platform }: { platform: DownloadPlatform }) {
  return platform.id === "linux-x64" ? <Terminal size={15} /> : <AppleIcon />;
}

export function DownloadLink({ small = false }: { small?: boolean }) {
  const platform = useDownloadPlatform();
  const className = small ? "button button-dark button-small" : "button button-dark";
  return (
    <a href={downloadStartedPath(platform)} className={className}>
      <PlatformIcon platform={platform} />
      {platform.shortLabel}
      <ArrowDown size={15} />
    </a>
  );
}

export function Downloads() {
  const platform = useDownloadPlatform();
  const others = downloads.filter((candidate) => candidate.id !== platform.id);
  return (
    <section id="download" className="download-section container" aria-labelledby="download-title">
      <div className="download-intro">
        <span className="eyebrow">MAKE ROOM FOR WHAT’S NEXT</span>
        <h2 id="download-title">
          Great ideas deserve
          <br />a little <em>gravity.</em>
        </h2>
        <p>
          Your agents. Your machine. Your next big thing.
          <br />
          Bring it all together in one workspace.
        </p>
        <div className="download-facts">
          <span>
            <Check size={14} /> Local by design
          </span>
          <span>
            <Check size={14} /> Your existing agents
          </span>
        </div>
      </div>
      <div className="download-card">
        <div className="download-card-top">
          <div className="app-icon">
            <GravityMark />
          </div>
          <span className="platform-badge">{platform.badge}</span>
        </div>
        <h3>Gravity for {platform.name}</h3>
        <p className="download-requirement">{platform.requirement}</p>
        <a className="button button-dark download-action" href={downloadStartedPath(platform)}>
          <PlatformIcon platform={platform} />
          {platform.actionLabel}
          <ArrowDown size={16} />
        </a>
        <p className="download-status">
          {`${platform.formatLabel} (${platform.format})${releaseVersion ? ` · v${releaseVersion}` : ""}`}
        </p>
        {others.map((other) => (
          <div className="download-platforms" key={other.id}>
            <span>
              <PlatformIcon platform={other} /> {other.name}
            </span>
            <a href={downloadStartedPath(other)}>
              Download {other.format} <ArrowDown size={12} />
            </a>
          </div>
        ))}
        <div className="download-platforms">
          <span>
            <Monitor size={15} /> Windows
          </span>
          <span>
            Coming later <ArrowUpRight size={12} />
          </span>
        </div>
      </div>
      <div className="download-footnote">
        <Command size={13} /> Made for the people who can’t stop making things.
      </div>
    </section>
  );
}
