import { env } from '../env-helpers.js';

// Overrides for TEST_ENV=qa. List only what differs from config/default.js.
export default {
  services: {
    petstore: {
      baseURL: env('PETSTORE_BASE_URL', 'https://petstore3.swagger.io/api/v3'),
    },
  },
};
