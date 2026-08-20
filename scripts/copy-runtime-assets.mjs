import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(root, 'src', 'skills');
const targetRoot = join(root, 'dist', 'skills');

await mkdir(targetRoot, { recursive: true });
for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const source = join(sourceRoot, entry.name, 'SKILL.md');
  const target = join(targetRoot, entry.name, 'SKILL.md');
  await mkdir(join(targetRoot, entry.name), { recursive: true });
  await cp(source, target);
}
