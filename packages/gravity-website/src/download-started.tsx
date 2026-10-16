import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, ArrowDown } from "lucide-react";
import { Brand, GravityMark } from "./components/brand";
import { PlatformIcon } from "./components/downloads";
import {
  type DownloadPlatform,
  detectDownloadPlatform,
  downloadStartedPath,
  downloads,
  findDownloadPlatform,
} from "./releases";
import "./styles.css";

function resolvePlatform(): DownloadPlatform {
  const requested = new URLSearchParams(window.location.search).get("platform");
  return findDownloadPlatform(requested) ?? detectDownloadPlatform();
}

function DownloadStarted() {
  const [platform] = useState(resolvePlatform);
  const others = downloads.filter((candidate) => candidate.id !== platform.id);
  const startedRef = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in development; start the download once.
    if (startedRef.current) return;
    startedRef.current = true;
    window.location.assign(platform.url);
  }, [platform]);

  return (
    <div id="home">
      <header className="site-header container">
        <Brand href="/" />
      </header>
      <main id="main" className="download-section download-started container">
        <div className="download-intro">
          <span className="eyebrow">YOUR DOWNLOAD HAS STARTED</span>
          <h2>
            Thanks for downloading
            <br />
            <em>Gravity.</em>
          </h2>
          <p>
            Your download should begin automatically. If it doesn&apos;t, use the button on this
            page.
          </p>
          <a className="text-link download-started-back" href="/">
            <ArrowLeft size={15} /> Back to Gravity
          </a>
        </div>
        <div className="download-card">
          <div className="download-card-top">
            <div className="app-icon">
              <GravityMark />
            </div>
            <span className="platform-badge">{platform.badge}</span>
          </div>
          <h3>Install Gravity on {platform.name}</h3>
          <p className="download-requirement">{platform.requirement}</p>
          <ol className="install-steps">
            {platform.installSteps.map((step) => (
              <li key={step.text}>
                {step.text}
                {step.command && <code className="install-command">{step.command}</code>}
              </li>
            ))}
          </ol>
          <a className="button button-dark download-action" href={platform.url}>
            <PlatformIcon platform={platform} />
            Download again
            <ArrowDown size={16} />
          </a>
          {others.map((other) => (
            <div className="download-platforms" key={other.id}>
              <span>
                <PlatformIcon platform={other} /> Not on {platform.name}?
              </span>
              <a href={downloadStartedPath(other)}>
                Get Gravity for {other.name} <ArrowDown size={12} />
              </a>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Gravity root element is missing");

createRoot(root).render(
  <StrictMode>
    <DownloadStarted />
  </StrictMode>,
);
