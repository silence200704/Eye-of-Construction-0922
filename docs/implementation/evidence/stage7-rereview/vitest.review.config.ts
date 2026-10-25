import config from '../../../../vitest.config'
export default {
  ...config,
  test: { ...config.test, include: ['docs/implementation/evidence/stage7-rereview/*.test.ts'] },
}
