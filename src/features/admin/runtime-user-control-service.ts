import { adminIdentityControl } from './cognito-admin'
import { createAdminUserControlService } from './user-control-service'

export const runtimeAdminUserControlService = createAdminUserControlService({
  identityAdmin: adminIdentityControl,
})
