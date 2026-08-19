# Dexter Headless gRPC and SSH Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a headless Dexter runtime with a stable gRPC protocol, deploy it on the nofx server, and provide a local SSH CLI for remote research conversations.

**Architecture:** Keep `bun start` as the interactive CLI. Add a shared headless runner around `Agent.create`/`Agent.run`, then expose it through a gRPC server with run state, cancellation, event sequencing, and bounded replay. The local command uses SSH stdin/stdout to invoke a remote line-oriented client, so the gRPC port and credentials remain private on the server.

**Tech Stack:** Bun, TypeScript, LangChain Agent, `@grpc/grpc-js`, `@grpc/proto-loader`, protobuf, SSH, Bun test.

---

### Task 1: Establish the headless runtime contract

**Files:**
- Create: `src/headless/types.ts`
- Create: `src/headless/runner.ts`
- Test: `src/headless/runner.test.ts`

- [ ] Write tests for accepted, completed, failed, and cancelled event behavior using a mocked Agent factory.
- [ ] Run `bun test src/headless/runner.test.ts` and verify the new tests fail because the runner does not exist.
- [ ] Implement the runner with `run_id`, `session_id`, AbortSignal, event sequence, max-iteration and concurrency admission checks; use `channel: 'headless'` so CLI-only tools are excluded.
- [ ] Run the focused tests and verify they pass.

### Task 2: Add the versioned protobuf and gRPC server

**Files:**
- Create: `proto/nofx/dexter/v1/dexter_runtime.proto`
- Create: `src/server/config.ts`
- Create: `src/server/run-store.ts`
- Create: `src/server/grpc-server.ts`
- Create: `src/server/index.ts`
- Modify: `package.json`
- Test: `src/server/run-store.test.ts`

- [ ] Define `Execute`, `GetRun`, `CancelRun`, `ResumeRun`, and `HealthCheck` plus sequenced runtime events from the approved design.
- [ ] Add tests for bounded event replay, idempotent event IDs, run lookup, and terminal state transitions.
- [ ] Run the focused store tests red, then implement the in-memory bounded store.
- [ ] Implement the gRPC handlers with token metadata validation, per-run cancellation, graceful shutdown, and no terminal UI output.
- [ ] Add `server` and `server:dev` scripts and the two gRPC dependencies.
- [ ] Run `bun run typecheck` and focused server tests.

### Task 3: Add the local SSH conversation tool

**Files:**
- Create: `src/remote-cli/protocol.ts`
- Create: `src/remote-cli/client.ts`
- Create: `src/remote-cli/index.ts`
- Modify: `package.json`
- Test: `src/remote-cli/protocol.test.ts`

- [ ] Define a JSON-lines protocol carrying query, progress, answer, failure, and end messages without leaking environment values.
- [ ] Test protocol parsing and malformed-message handling.
- [ ] Implement the client with configurable host/user/key/remote directory, `ssh -T`, signal forwarding, one-shot query mode, and interactive stdin mode.
- [ ] Add a `remote` bin/script while preserving `bun start`.
- [ ] Run protocol tests and typecheck.

### Task 4: Add deployment configuration and process lifecycle

**Files:**
- Create: `deploy/dexter.service`
- Create: `deploy/remote.mk`
- Create: `.env.example` additions only if needed
- Modify: `package.json`

- [ ] Use the nofx server/SSH defaults while keeping the Dexter directory and environment independent.
- [ ] Add remote install, sync, build, start, status, logs, and stop targets; never print secrets or overwrite nofx files.
- [ ] Configure loopback gRPC binding, service token, max concurrency, event buffer, and persistent Dexter data directory.
- [ ] Verify the service is supervised and has a health/status command.

### Task 5: Verify locally, deploy remotely, and run a real probe

- [ ] Run `bun install`, `bun test`, `bun run typecheck`, and `git diff --check`.
- [ ] Deploy with `make -f deploy/remote.mk remote-deploy` using the existing SSH key and server.
- [ ] Verify the remote process, loopback listener, health RPC, and distinctive startup log.
- [ ] Run the local remote CLI with a minimal research prompt and record the actual result or the exact external-credential blocker.
- [ ] Confirm no nofx files, environment files, or credentials were changed.

