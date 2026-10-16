import { useCallback, useState } from "react";
import type { ComponentType, MouseEvent, SVGProps } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode2,
  Folder,
  GitBranch,
  Layers2,
  MessageSquare,
  PanelLeft,
  Plus,
  Settings2,
  Terminal,
} from "lucide-react";
import { GravityMark } from "./brand";
import { ClaudeLogo, CodexLogo, OpenCodeLogo } from "./provider-logos";

interface DemoTask {
  id: string;
  name: string;
  provider: string;
  logo: ComponentType<SVGProps<SVGSVGElement>>;
  branch: string;
  prompt: string;
  response: string;
  file: string;
  additions: number;
  lines: string[];
}

const tasks: DemoTask[] = [
  {
    id: "onboarding",
    name: "Build the onboarding flow",
    provider: "Claude Code",
    logo: ClaudeLogo,
    branch: "feat/onboarding",
    prompt: "Build a welcoming onboarding flow. Keep it simple, and make it feel like us.",
    response:
      "I’ve built a three-step onboarding flow with your existing components. The transitions are in, and it’s ready for a look.",
    file: "onboarding.tsx",
    additions: 128,
    lines: [
      'import { motion } from "motion/react";',
      "",
      "export function Onboarding() {",
      "  const [step, setStep] = useState(0);",
      "",
      "  return (",
      "    <motion.section",
      "      initial={{ opacity: 0 }}",
      "      animate={{ opacity: 1 }}",
      '      className="welcome"',
      "    >",
      "      <h1>Make yourself at home.</h1>",
      "      <Steps current={step} />",
      "      <Button onClick={nextStep}>",
      "        Let’s get started",
      "      </Button>",
      "    </motion.section>",
      "  );",
      "}",
    ],
  },
  {
    id: "search",
    name: "Add command menu",
    provider: "Codex",
    logo: CodexLogo,
    branch: "feat/command-menu",
    prompt:
      "Add a keyboard-first command menu. I want to jump between projects without leaving the keyboard.",
    response:
      "The command menu is ready. It supports fuzzy search, arrow-key navigation, and a shortcut to open it from anywhere.",
    file: "command-menu.tsx",
    additions: 86,
    lines: [
      'import { Command } from "cmdk";',
      "",
      "export function CommandMenu() {",
      "  const projects = useProjects();",
      "",
      "  return (",
      '    <Command label="Jump to…">',
      "      <Command.Input",
      '        placeholder="Find a project"',
      "      />",
      "      <Command.List>",
      "        <Command.Empty>",
      "          No projects found.",
      "        </Command.Empty>",
      "        <ProjectItems",
      "          projects={projects}",
      "        />",
      "      </Command.List>",
      "    </Command>",
      "  );",
      "}",
    ],
  },
  {
    id: "tests",
    name: "Cover the auth edge cases",
    provider: "OpenCode",
    logo: OpenCodeLogo,
    branch: "test/auth-flow",
    prompt:
      "Add regression tests for expired sessions and failed sign-ins. Check the redirect behavior too.",
    response:
      "The new tests cover expired tokens, failed sign-ins, and return URLs. All twelve checks pass, including the existing suite.",
    file: "auth.test.ts",
    additions: 64,
    lines: [
      'import { test, expect } from "vitest";',
      "",
      'test("expires a stale session", () => {',
      "  const session = createSession({",
      "    expiresAt: Date.now() - 1000,",
      "  });",
      "",
      "  expect(session.isValid).toBe(false);",
      "});",
      "",
      'test("preserves the return URL", () => {',
      "  const result = signIn({",
      '    returnTo: "/workspace",',
      "  });",
      "",
      "  expect(result.redirect)",
      '    .toBe("/workspace");',
      "});",
    ],
  },
];

export function WorkspacePreview() {
  const [taskId, setTaskId] = useState(tasks[0].id);
  const task = tasks.find((item) => item.id === taskId) ?? tasks[0];

  const selectTask = useCallback(function selectTask(event: MouseEvent<HTMLButtonElement>) {
    setTaskId(event.currentTarget.value);
  }, []);

  return (
    <section
      id="preview"
      className="preview-section container"
      aria-label="Interactive Gravity workspace preview"
    >
      <div className="preview-topline">
        <span>
          <span className="status-dot" /> A little space for your next big thing.
        </span>
        <span className="mono">THE GRAVITY WORKSPACE ↓</span>
      </div>
      <div className="workspace-window">
        <div className="window-titlebar">
          <div className="traffic-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>
            <GravityMark /> gravity
          </span>
          <span className="window-local">
            <span className="status-dot" /> Local workspace
          </span>
        </div>
        <div className="workspace-body">
          <aside className="demo-sidebar" aria-label="Example tasks">
            <div className="sidebar-project">
              <span className="project-icon">s</span> studio <ChevronDown size={12} />
              <PanelLeft size={14} />
            </div>
            <div className="sidebar-item">
              <Layers2 size={14} /> All workspaces <span>3</span>
            </div>
            <div className="sidebar-label">
              PROJECTS <Plus size={13} />
            </div>
            <div className="sidebar-repo">
              <ChevronDown size={12} />
              <Folder size={14} /> studio-web
            </div>
            <div className="demo-task-list" role="group" aria-label="Switch preview task">
              {tasks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  value={item.id}
                  onClick={selectTask}
                  className="demo-task"
                  aria-pressed={task.id === item.id}
                >
                  <span className="task-indicator" />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
            <div className="sidebar-repo muted">
              <ChevronRight size={12} />
              <Folder size={14} /> design-system
            </div>
            <div className="sidebar-bottom">
              <div className="local-note">
                <span className="status-dot" /> Everything, on your machine.
              </div>
              <div className="sidebar-settings">
                <Settings2 size={14} /> Settings <kbd>⌘ ,</kbd>
              </div>
            </div>
          </aside>
          <div className="demo-conversation" aria-live="polite">
            <div className="pane-heading">
              <span>{task.name}</span>
              <span className="ready-badge">
                <Check size={10} /> Ready to review
              </span>
            </div>
            <div className="demo-branch">
              <GitBranch size={12} />
              {task.branch}
            </div>
            <div className="conversation-content" key={task.id}>
              <div className="chat-person">
                <span className="avatar-user">Y</span>
                <strong>You</strong>
                <span>just now</span>
              </div>
              <p className="chat-prompt">{task.prompt}</p>
              <div className="chat-person">
                <task.logo className="avatar-agent" />
                <strong>{task.provider}</strong>
                <span>just now</span>
              </div>
              <p className="chat-response">{task.response}</p>
              <div className="tool-result">
                <Check size={12} />
                <span>Read project files</span>
                <ChevronDown size={12} />
              </div>
              <div className="tool-result">
                <Check size={12} />
                <span>Updated {task.file}</span>
                <span className="green">+{task.additions}</span>
              </div>
              <div className="tool-result">
                <Check size={12} />
                <span>All checks passed</span>
                <span className="muted">12 / 12</span>
              </div>
              <div className="demo-summary">
                <FileCode2 size={14} />
                <span>3 files changed</span>
                <span className="green">+{task.additions}</span>
                <span className="red">−12</span>
                <ChevronRight size={13} />
              </div>
            </div>
            <DemoComposer provider={task.provider} />
          </div>
          <div className="demo-editor">
            <div className="editor-tabs">
              <span>
                <Code2 size={13} /> Changes <i>3</i>
              </span>
              <span>
                <Folder size={13} /> Files
              </span>
            </div>
            <div className="editor-filename">
              <FileCode2 size={13} />
              {task.file}
              <span className="green">+{task.additions}</span>
            </div>
            <CodePreview task={task} />
            <div className="editor-status">
              <span>
                <GitBranch size={11} /> {task.branch}
              </span>
              <span>TypeScript React</span>
            </div>
          </div>
        </div>
        <div className="window-status">
          <span>
            <GitBranch size={10} /> studio-web <span className="status-separator">/</span>{" "}
            {task.branch}
          </span>
          <span>
            <Check size={10} /> All changes saved <span className="status-separator">·</span>{" "}
            <Terminal size={10} /> <MessageSquare size={10} />
          </span>
        </div>
      </div>
      <div className="preview-caption">
        <span className="mono">INTERACTIVE PREVIEW</span>
        <span>Pick a task. See everything fall into place.</span>
        <span className="caption-arrow">↖</span>
      </div>
    </section>
  );
}

function DemoComposer({ provider }: { provider: string }) {
  return (
    <div className="demo-composer" aria-hidden="true">
      <span>What shall we build next?</span>
      <div>
        <Plus size={14} />
        <span>
          {provider} <ChevronDown size={10} />
        </span>
        <span className="send-icon">
          <ArrowUp size={13} />
        </span>
      </div>
    </div>
  );
}

function CodePreview({ task }: { task: DemoTask }) {
  const lines = task.lines.map((text, index) => ({ number: index + 1, text }));
  return (
    <div className="code-lines">
      <div className="code-hunk">@@ changes on {task.branch}</div>
      {lines.map((line) => (
        <div className="code-line" key={line.number}>
          <span className="line-number">{line.number}</span>
          <span className="diff-plus">+</span>
          <code>{line.text || " "}</code>
        </div>
      ))}
    </div>
  );
}
