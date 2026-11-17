/**
 * Architecture boundaries, checked with `bun run deps`. `generic` gives no-circular and
 * production-not-tests for apps/* and packages/*; add layer rules (features may not import
 * each other, shared/ knows no feature, ...) as your structure grows. Every rule is `error`:
 * a violation is a decision, not a warning.
 */
import { makeConfig } from 'bank20baht-strict/depcruise'

export default makeConfig({ generic: true })
