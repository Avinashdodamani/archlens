import { Amplify } from 'aws-amplify';

/**
 * Configure AWS Amplify for Cognito authentication.
 * All values come from environment variables — no hardcoded credentials.
 */
export function configureAmplify(): void {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
        userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
        loginWith: {
          oauth: {
            domain: import.meta.env.VITE_COGNITO_DOMAIN,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [window.location.origin + '/callback'],
            redirectSignOut: [window.location.origin],
            responseType: 'code',
          },
        },
      },
    },
  });
}
