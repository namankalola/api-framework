import { env } from '../env-helpers.js';

// Overrides for TEST_ENV=stage. Shows how auth can change per environment.
export default {
  services: {
    petstore: {
      baseURL: env('PETSTORE_BASE_URL', 'https://petstore3.swagger.io/api/v3'),
      // auth: {
      //   type: 'oauth2',
      //   grantType: 'client_credentials',
      //   tokenUrl: env('PETSTORE_TOKEN_URL'),
      //   clientId: env('PETSTORE_CLIENT_ID'),
      //   clientSecret: env('PETSTORE_CLIENT_SECRET'),
      //   scope: 'read:pets write:pets',
      // },
    },
  },
  http: { retries: 3 },
};
