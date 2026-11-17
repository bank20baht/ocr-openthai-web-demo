/**
 * `bun run scripts/each.ts <script>` — run `<script>` in every apps/* and
 * packages/* workspace that defines it, one after another, failing on the
 * first non-zero exit. Unlike `bun run --filter '*' <script>` it exits 0 when
 * no workspace defines the script yet, so a fresh repo passes `bun run check`.
 */
import { workspacesWithScript } from './workspaces.ts'

const script = process.argv[2]
if (!script) {
  console.error('usage: bun run scripts/each.ts <script>')
  process.exit(1)
}

const targets = workspacesWithScript(script)
if (targets.length === 0) {
  console.log(`No workspace defines "${script}" yet — nothing to run.`)
  process.exit(0)
}

for (const { name, cwd } of targets) {
  console.log(`\x1b[36m[${name}]\x1b[0m bun run ${script}`)
  const proc = Bun.spawnSync(['bun', 'run', script], {
    cwd,
    env: process.env,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  if (proc.exitCode !== 0) process.exit(proc.exitCode)
}
