# Remote HTTP SSE CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an HTTP SSE transport to `bun run remote` while preserving SSH as the default and persist the Dexter service token in a local user configuration file.

**Architecture:** Parse the first optional transport argument as `ssh` or `http`; keep the existing SSH JSONL bridge unchanged. Add a small local configuration module for the HTTP URL and service token, and a separate SSE client that consumes Dexter `event:`/`data:` frames and maps progress, report, completion, failure, and cancellation to the existing CLI output style.

**Tech Stack:** Bun, TypeScript, Bun test runner, native `fetch`, Node filesystem APIs.

---

### Task 1: Add transport and local configuration tests

**Files:**
- Create: `src/remote-cli/config.ts`
- Create: `src/remote-cli/config.test.ts`
- Create: `src/remote-cli/args.ts`
- Create: `src/remote-cli/args.test.ts`

- [ ] **Step 1: Write failing tests** for default SSH parsing, `http` transport parsing, `--query`, and config path/mode serialization.
- [ ] **Step 2: Run `bun test src/remote-cli/args.test.ts src/remote-cli/config.test.ts` and confirm the new imports/functions fail because they do not exist.
- [ ] **Step 3: Implement typed argument parsing and a `~/.config/dexter/config.json` reader/writer with `0600` permissions.
- [ ] **Step 4: Re-run the focused tests and confirm they pass.

### Task 2: Add SSE client tests and implementation

**Files:**
- Create: `src/remote-cli/sse-client.ts`
- Create: `src/remote-cli/sse-client.test.ts`

- [ ] **Step 1: Write failing tests** for parsing SSE frames and rendering report/completed/failed events.
- [ ] **Step 2: Run the focused SSE test and confirm it fails because the client does not exist.
- [ ] **Step 3: Implement native `fetch` streaming with `Accept: text/event-stream`, `Authorization: Bearer`, line buffering, and AbortSignal cancellation.
- [ ] **Step 4: Re-run the focused SSE tests and confirm they pass.

### Task 3: Integrate the `remote` command

**Files:**
- Modify: `src/remote-cli/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Keep the current SSH process path as the default when no transport is supplied.
- [ ] **Step 2: Add `bun run remote http --query "..."` and interactive HTTP mode.
- [ ] **Step 3: Add `bun run remote config set-url`, `config set-token`, `config show`, and `config clear-token`.
- [ ] **Step 4: Run all remote CLI tests and `bun run typecheck`.

### Task 4: Verify the real HTTP SSE endpoint

**Files:**
- No production files.

- [ ] **Step 1: Use a non-secret placeholder/configured token and run a short HTTP health check.
- [ ] **Step 2: Run one minimal `bun run remote http --query` request against the deployed Dexter endpoint.
- [ ] **Step 3: Confirm the CLI receives a terminal `completed` or `failed` event and report the exact provider/runtime result.
