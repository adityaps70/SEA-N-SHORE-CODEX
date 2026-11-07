import { config } from 'zod'

// Zod checks whether the browser allows code generation by calling Function('') the first time it validates an
// object. Our Content Security Policy has no 'unsafe-eval', so that probe is reported today (the "eval" reports
// from many sections in the CSP review) and blocked once the policy is enforced. Jitless mode skips the probe and
// uses Zod's plain validator; results are identical. Runs synchronously before hydration (instrumentation-client).
config({ jitless: true })
