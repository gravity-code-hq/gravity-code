---
title: Workspaces
description: Understand how Gravity groups working directories, agents, terminals, and browsers into workspaces.
nav: Workspaces
order: 10
category: Workspaces
---

# Workspaces

Gravity is organized around workspaces, not chats.

A workspace is the place where a task happens. It has a working directory and can contain multiple sessions running at the same time. In the app, each session opens as a tab.

## Projects contain workspaces

The sidebar starts with projects. A project can be a git repository, a GitHub project, or any directory on a machine running the Gravity daemon.

Inside each project are workspaces. For example:

```
my-app
├── main
├── fix-login-flow
└── redesign-settings
```

Each workspace is a separate place to work. You can keep one for your main checkout, create another for a feature, or open a GitHub PR as another workspace.

Use the [CLI project commands](/docs/cli#projects) to register, list, rename, or delete projects.

## Workspaces contain sessions

Agents run inside a workspace as sessions. A workspace can have one agent session, several agent sessions, terminals, browsers, and diffs open at the same time.

That matters because real development rarely fits into one long chat. You might ask one agent to implement a feature, open a terminal to run a service, start another agent to review the diff, and keep the browser open next to both. Those belong together because they are all part of the same task.

In Gravity, the workspace is the stable container. The sessions are what you run inside it.

## Every workspace gets its own directory

Creating a workspace for a git project cuts a managed git worktree with its own branch. Agents in different workspaces never share working files, so two tasks on the same project cannot step on each other. The worktree shares git history with your main checkout, so commits made in a workspace show up there as a branch.

A project that is not a git repository has nothing to branch from. Its workspaces attach to the directory itself and share its files.

The workspace is the product concept; the git worktree is how its files are isolated. More than one workspace can refer to the same managed worktree, and Gravity removes that worktree after its last workspace is archived.

## Creating a workspace

You can create a workspace in the app or from the CLI:

```bash
gravity workspace create --path ~/dev/my-app --base origin/main
gravity workspace create --path ~/dev/my-app --mode checkout-pr --pr-number 2186
```

You can also create a workspace without starting an agent right away. The workspace is still there with its working directory ready; you can open terminals, run services, or browse files, then start an agent later.

Either way, once the workspace exists you can add more sessions to it. Open a terminal alongside an agent, start a second agent to review changes, or open a browser tab to check a local service. Every session lives as a tab inside the same workspace.

Creating an agent and creating a workspace are separate actions. Pass a workspace ID when you want an agent in a specific existing workspace. A bare `gravity run` from a human shell creates a workspace on the current directory; when one agent runs it, Gravity recognizes the caller and creates a subagent in the caller's workspace.

## Worktrees

Every workspace in Gravity is backed by a working directory. When that directory is a git worktree, you get a separate branch and isolated environment for each task.

If you want the details on configuring setup hooks, scripts, and services, continue to [Git worktrees](/docs/worktrees).
