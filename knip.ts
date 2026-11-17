import { knip } from 'bank20baht-strict/knip'

export default knip({
  workspaces: {
    '.': { entry: ['scripts/*.ts'], project: ['scripts/**/*.ts'] },
  },
})
