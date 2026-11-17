import { defineConfig } from 'eslint/config'

import { angular, bahtui, base } from 'bank20baht-strict/eslint'

/** The browser app. */
const WEB = ['apps/web/src/**']

// Every rule in `base` is an error. Add app overrides below, each with a reason:
//   // eslint-disable-next-line <rule> -- <why>
export default defineConfig([
  ...base,
  ...angular({ files: WEB, restrictedImports: [] }),
  ...bahtui({ files: WEB, tokenFiles: ['apps/web/src/styles.css'] }),
])
