#!/usr/bin/env bun
import { resolveAttachTarget, uniqueSessionName } from './session.js';

function flag(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0) {
    return '';
  }
  return args[index + 1] ?? '';
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseNow(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return new Date();
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

function usage(): never {
  console.error('usage: session-cli.ts name [--now YYYY-MM-DDTHH:MM:SS] [--existing a,b]');
  console.error('       session-cli.ts resolve --last NAME --live a,b');
  process.exit(2);
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'name') {
    const now = parseNow(flag(args, '--now'));
    const existing = splitList(flag(args, '--existing'));
    console.log(uniqueSessionName(now, existing));
    return;
  }

  if (command === 'resolve') {
    const last = flag(args, '--last').trim() || null;
    const live = splitList(flag(args, '--live'));
    const target = resolveAttachTarget(last, live);
    if (target.action === 'attach') {
      console.log(`attach ${target.session}`);
    } else {
      console.log('create');
    }
    return;
  }

  usage();
}

if (import.meta.main) {
  main();
}
