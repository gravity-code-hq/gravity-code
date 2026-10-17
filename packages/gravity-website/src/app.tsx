import { useCallback, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Code2,
  GitBranch,
  Menu,
  Monitor,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Brand, GravityMark } from "./components/brand";
import { Downloads, DownloadLink } from "./components/downloads";
import {
  ClaudeLogo,
  CodexLogo,
  GitHubLogo,
  OpenCodeLogo,
  PiLogo,
} from "./components/provider-logos";
import { Orbit } from "./components/orbit";
import { WorkspacePreview } from "./components/workspace-preview";
import { GITHUB_REPO_URL } from "./releases";

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleMenu = useCallback(function toggleMenu() {
    setMenuOpen((open) => !open);
  }, []);
  const closeMenu = useCallback(function closeMenu() {
    setMenuOpen(false);
  }, []);

  return (
    <header className="site-header container">
      <Brand />
      <nav className="desktop-nav" aria-label="Main navigation">
        <a href="#features">Why Gravity</a>
        <a href="#workflow">How it works</a>
        <a href="#faq">FAQs</a>
      </nav>
      <div className="header-actions">
        <a
          className="github-link"
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Gravity on GitHub"
        >
          <GitHubLogo />
        </a>
        <DownloadLink small />
        <button
          type="button"
          className="menu-toggle"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={toggleMenu}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </div>
      {menuOpen && (
        <nav
          id="mobile-navigation"
          className="mobile-nav"
          aria-label="Mobile navigation"
          onClick={closeMenu}
        >
          <a href="#features">
            Why Gravity <ArrowRight size={16} />
          </a>
          <a href="#workflow">
            How it works <ArrowRight size={16} />
          </a>
          <a href="#faq">
            FAQs <ArrowRight size={16} />
          </a>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            GitHub <ArrowUpRightSmall />
          </a>
          <a href="#download">
            Get Gravity <ArrowDown size={16} />
          </a>
        </nav>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="hero container" aria-labelledby="hero-title">
      <div className="hero-copy">
        <a href="#download" className="hero-announcement">
          <span className="announcement-dot" /> A new home for your coding agents{" "}
          <ArrowUpRightSmall />
        </a>
        <h1 id="hero-title">
          Your agents.
          <br />
          One <em>orbit.</em>
        </h1>
        <p>
          A little less friction. A lot more building.
          <br />
          Bring your AI coding agents together in one
          <br className="desktop-break" /> beautifully focused desktop workspace.
        </p>
        <div className="hero-actions">
          <DownloadLink />
          <a className="text-link" href="#preview">
            Take a look inside <ArrowDown size={15} />
          </a>
        </div>
        <div className="hero-meta">
          <span>macOS · Linux</span>
          <i />
          <span>Your code stays local</span>
        </div>
      </div>
      <div className="hero-art">
        <span className="art-coordinate mono">FIG. 01 — FIND YOUR CENTER</span>
        <Orbit />
        <span className="art-bottom-note mono">
          <span className="crosshair">+</span> BUILT FOR THE WAY YOU BUILD
        </span>
      </div>
    </section>
  );
}

function ArrowUpRightSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 9 9 3M3 3h6v6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function Providers() {
  return (
    <section className="providers container" aria-label="Supported coding agents">
      <p>YOUR FAVORITE AGENTS. RIGHT AT HOME.</p>
      <div className="provider-list">
        <span className="provider-claude">
          <ClaudeLogo /> Claude Code
        </span>
        <span>
          <CodexLogo /> Codex
        </span>
        <span>
          <OpenCodeLogo /> OpenCode
        </span>
        <span>
          <PiLogo /> Pi
        </span>
        <span className="provider-note">
          Same tools.
          <br />
          More headspace.
        </span>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="features container" aria-labelledby="features-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">LESS JUGGLING. MORE BUILDING.</span>
          <h2 id="features-title">
            Everything in place.
            <br />
            You, in your <em>flow.</em>
          </h2>
        </div>
        <p>
          Give every idea room to grow.
          <br />
          Gravity keeps the moving parts together,
          <br />
          so you can focus on what comes next.
        </p>
      </div>
      <div className="feature-grid">
        <ParallelFeature />
        <ReviewFeature />
        <LocalFeature />
      </div>
    </section>
  );
}

function ParallelFeature() {
  return (
    <article className="feature-card">
      <div className="feature-visual branch-visual" aria-hidden="true">
        <div className="mini-repo">
          <GitBranch size={13} /> your next big thing <span>main</span>
        </div>
        <div className="branch-trunk" />
        <div className="mini-task">
          <ClaudeLogo className="claude-color" width={17} height={17} />
          <span>Build the onboarding</span>
          <span className="mini-status">Working</span>
        </div>
        <div className="mini-task">
          <CodexLogo width={17} height={17} />
          <span>Polish the dashboard</span>
          <span className="mini-status ready">
            Ready <Check size={9} />
          </span>
        </div>
        <div className="mini-task">
          <OpenCodeLogo width={16} height={16} />
          <span>Fix that little bug</span>
          <span className="mini-status">Working</span>
        </div>
      </div>
      <span className="feature-index mono">01 / ROOM TO EXPLORE</span>
      <h3>More ideas. In parallel.</h3>
      <p>
        Give each task its own workspace and git worktree. Let your agents make progress side by
        side.
      </p>
    </article>
  );
}

function ReviewFeature() {
  return (
    <article className="feature-card">
      <div className="feature-visual review-visual" aria-hidden="true">
        <div className="mini-file">
          <Code2 size={13} /> the-next-big-thing.tsx<span>+24 −8</span>
        </div>
        <div className="mini-diff removed">− const idea = &quot;someday&quot;;</div>
        <div className="mini-diff added">+ const idea = &quot;let’s build it&quot;;</div>
        <div className="mini-diff"> </div>
        <div className="mini-diff added">+ await makeItHappen(idea);</div>
        <div className="mini-review">
          <span className="review-check">
            <Check size={11} />
          </span>{" "}
          All checks passed <span>Ready for your eyes</span>
        </div>
      </div>
      <span className="feature-index mono">02 / THE WHOLE PICTURE</span>
      <h3>From “done” to understood.</h3>
      <p>
        See what changed, explore the diff, and keep the conversation going. The context is already
        there.
      </p>
    </article>
  );
}

function LocalFeature() {
  return (
    <article className="feature-card">
      <div className="feature-visual local-visual" aria-hidden="true">
        <div className="local-orbit">
          <div />
          <div />
          <span>
            <Monitor size={31} />
            <GravityMark />
          </span>
          <i className="local-lock">
            <ShieldCheck size={16} />
          </i>
        </div>
        <div className="local-visual-label">
          <span className="status-dot" /> YOUR MACHINE. YOUR RULES.
        </div>
      </div>
      <span className="feature-index mono">03 / CLOSE TO HOME</span>
      <h3>Your setup, still yours.</h3>
      <p>
        Work with local files, your installed agents, and your existing credentials. No moving your
        repo to our cloud.
      </p>
    </article>
  );
}

const workflowSteps = [
  {
    number: "01",
    title: "Make yourself at home.",
    description:
      "Install Gravity on your Mac or Linux machine. Bring an installed, signed-in coding agent and a project you care about.",
  },
  {
    number: "02",
    title: "Give your ideas an agent.",
    description:
      "Open a workspace, pick your agent, and describe what you want to build. Start another task whenever inspiration strikes.",
  },
  {
    number: "03",
    title: "Stay in the creative seat.",
    description:
      "Follow the progress, steer the work, and review the changes. You bring the direction. Your agents bring the momentum.",
  },
];

function Workflow() {
  return (
    <section id="workflow" className="workflow-section" aria-labelledby="workflow-title">
      <div className="container workflow-inner">
        <div className="workflow-intro">
          <span className="eyebrow">A SMALL SHIFT. A BETTER WORKDAY.</span>
          <h2 id="workflow-title">
            From idea
            <br />
            to <em>in motion.</em>
          </h2>
          <p>
            No elaborate setup.
            <br />
            Just a better place to start.
          </p>
          <a href="#download" className="text-link">
            Find your flow <ArrowRight size={16} />
          </a>
          <div className="workflow-orbit">
            <Orbit compact />
          </div>
        </div>
        <div className="workflow-steps">
          {workflowSteps.map((step) => (
            <article className="workflow-step" key={step.number}>
              <span className="step-number mono">{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </article>
          ))}
          <div className="workflow-note">
            <Sparkles size={16} /> Less setup energy. More creative energy.
          </div>
        </div>
      </div>
    </section>
  );
}

const questions = [
  {
    question: "What is Gravity?",
    answer:
      "Gravity is a desktop workspace for working with AI coding agents. Keep your conversations, local projects, terminals, and code changes together, and give separate tasks their own space to run.",
  },
  {
    question: "Which coding agents can I use?",
    answer:
      "Gravity works with Claude Code, Codex, OpenCode, and Pi. Use the agents you already have installed and signed in on your machine. Provider subscriptions and API usage remain with your provider.",
  },
  {
    question: "Does my code stay on my machine?",
    answer:
      "Your repositories and workspaces stay on your computer. Gravity runs your installed coding agents locally. Those agents still communicate with their model providers according to the provider and settings you choose.",
  },
  {
    question: "Which computers does Gravity support?",
    answer:
      "Apple Silicon Macs (M-series chips) running macOS 13 or newer, and 64-bit Linux desktops through a .deb package for Ubuntu, Debian, and Mint. Windows support is planned for later. Intel Macs are not supported.",
  },
  {
    question: "Do I need a new AI subscription?",
    answer:
      "Gravity uses your existing agent setup and credentials. You’ll need access to at least one supported coding agent; any subscription or API charges from that provider still apply.",
  },
  {
    question: "Can agents work on different tasks at once?",
    answer:
      "Yes. Start separate workspaces for different tasks. Optional git worktrees give each task its own working copy and branch, so agents can make changes without editing the same files in your main checkout.",
  },
];

function Faq() {
  return (
    <section id="faq" className="faq-section container" aria-labelledby="faq-title">
      <div className="faq-intro">
        <span className="eyebrow">A FEW GOOD QUESTIONS</span>
        <h2 id="faq-title">
          Before you
          <br />
          <em>settle in.</em>
        </h2>
        <p>The things you might be wondering.</p>
      </div>
      <div className="faq-list">
        {questions.map((item) => (
          <details key={item.question} className="faq-item" name="gravity-faq">
            <summary>
              {item.question}
              <ChevronDown size={17} />
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer container">
      <div className="footer-top">
        <div>
          <Brand />
          <p>A little less friction. A lot more building.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#features">Why Gravity</a>
          <a href="#workflow">How it works</a>
          <a href="#faq">FAQs</a>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            GitHub <ArrowUpRightSmall />
          </a>
          <a href="#download">
            Get Gravity <ArrowUpRightSmall />
          </a>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Gravity</span>
        <span>
          Made with intention. Built for momentum. <span className="footer-spark">✳</span>
        </span>
        <a href="#home">
          Back to top <ArrowRight size={12} />
        </a>
      </div>
    </footer>
  );
}

export function App() {
  return (
    <div id="home">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <WorkspacePreview />
        <Providers />
        <Features />
        <Workflow />
        <Faq />
        <Downloads />
      </main>
      <Footer />
    </div>
  );
}
