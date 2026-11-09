import type { Api } from '../../preload/index'

declare global {
  interface Window {
    /** Canonical automation bridge exposed by automation-preload.cjs. */
    automationApi: Api
    /** Transitional alias the ported TaskOrbit pages still use. */
    api: Api
  }
}

export {}
