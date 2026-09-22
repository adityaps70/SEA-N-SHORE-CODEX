import { createCognitoApi } from '@/lib/auth/cognito-api'
import { getCognitoEnvironment } from '@/lib/env'
import { createAccountDeletionService } from './service'

export const runtimeAccountDeletionService = {
  async deleteAccount(input: {
    profileId: string
    email: string | null
    password: string
  }) {
    const environment = getCognitoEnvironment()
    const api = createCognitoApi({
      region: environment.AWS_COGNITO_REGION,
      clientId: environment.AWS_COGNITO_CLIENT_ID,
    })
    return createAccountDeletionService({ api }).deleteAccount(input)
  },
}
