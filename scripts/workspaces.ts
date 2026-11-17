import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type Workspace = {
  name: string
  cwd: string
}

/** Every `apps/*` and `packages/*` directory whose package.json defines `script`. */
export function workspacesWithScript(script: string, groups = ['apps', 'packages']): Workspace[] {
  const found: Workspace[] = []
  for (const group of groups) {
    if (!existsSync(group)) continue
    for (const entry of readdirSync(group, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const cwd = join(group, entry.name)
      const pkgPath = join(cwd, 'package.json')
      if (!existsSync(pkgPath)) continue
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
      if (typeof pkg.scripts?.[script] === 'string') found.push({ name: entry.name, cwd })
    }
  }
  return found
}
