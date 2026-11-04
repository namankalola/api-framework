import { env, envBool, envInt, envList } from './env-helpers.js';

/**
 * Base configuration shared by every environment.
 * Files in ./env are deep-merged over this object (arrays are replaced, not merged).
 */
export default {
  // Used when an operationId exists in more than one spec.
  defaultService: 'petstore',

  // One entry per API / microservice: its own OpenAPI spec, base URL and auth.
  services: {
    petstore: {
      spec: 'specs/petstore.json', // path relative to project root, or a URL
      baseURL: env('PETSTORE_BASE_URL', 'https://petstore3.swagger.io/api/v3'),
      headers: { Accept: 'application/json' },
      auth: {
        type: 'apiKey', // none | apiKey | basic | bearer | oauth2 | cookie
        name: 'api_key',
        in: 'header',
        value: env('PETSTORE_API_KEY', 'special-key'),
      },
      // Extra identities, used with api.as('<profile>').
      authProfiles: {
        anonymous: { type: 'none' },
      },
      // Resources created by these operations are deleted automatically after each test.
      // Values starting with "$." are read from the create response body.
      cleanup: {
        addPet: { operation: 'deletePet', path: { petId: '$.id' } },
        placeOrder: { operation: 'deleteOrder', path: { orderId: '$.id' } },
        createUser: { operation: 'deleteUser', path: { username: '$.username' } },
      },
    },
  },

  http: {
    timeoutMs: envInt('HTTP_TIMEOUT_MS', 30_000),
    retries: envInt('HTTP_RETRIES', 2),
    retryDelayMs: 300,
    retryOnStatus: [429, 502, 503, 504],
    retryMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'], // idempotent only
    ignoreHTTPSErrors: envBool('IGNORE_HTTPS_ERRORS', false),
  },

  validation: {
    autoValidateResponses: envBool('AUTO_VALIDATE', true), // soft-assert every documented response
    validateSpecOnStartup: envBool('VALIDATE_SPEC', false), // slow for very large specs
  },

  data: {
    seed: Number(env('DATA_SEED')), // random per run unless DATA_SEED is set (see load-dotenv.js)
    locale: env('DATA_LOCALE', 'en'),
    includeOptionalFields: true,
    maxRefDepth: 4,
  },

  // Spec files dropped into this folder become services automatically (OpenAPI 2/3, JSON/YAML, Postman).
  // Base URL: <NAME>_BASE_URL or the spec's servers. Auth: <NAME>_AUTH_TYPE + secrets, or the spec's scheme.
  discovery: {
    enabled: envBool('SPEC_DISCOVERY', true),
    dir: 'specs',
  },

  // How the generated suites obtain ids for {pathParams}. By default they create the resource
  // through the matching POST (e.g. POST /pet for /pet/{petId}); list fixed values here only
  // for resources the API cannot create. Keys: "<param>" or "<service>:<operationId>.<param>".
  resources: {
    pathParams: {},
    verifyCreated: true, // read each created parent back; skip dependent tests with a hint if it is missing
  },

  // Auto-generated suites in tests/generated: every operation in every spec gets test cases per category.
  suites: {
    categories: envList('SUITES', [
      'contract',
      'positive',
      'negative',
      'boundary',
      'security',
      'resilience',
      'performance',
    ]),
    // Filters accept "*" wildcards and "service:operationId" or plain operationId.
    includeServices: envList('SUITE_SERVICES'),
    includeTags: envList('SUITE_TAGS'),
    includeOperations: envList('SUITE_OPS'),
    excludeOperations: [
      // The public Petstore demo's /user endpoints return 500 for every call.
      'petstore:*User*',
      'petstore:*Users*',
    ],
    includeDeprecated: false,
    maxCasesPerOperation: envInt('SUITE_MAX_CASES', 25),

    // Status codes that count as a correct answer. Override per service: services.<name>.expectations.
    expectations: {
      success: [200, 201, 202, 204],
      badRequest: [400, 422],
      unauthorized: [401, 403],
      forbidden: [403, 404],
      notFound: [404],
      methodNotAllowed: [405, 404],
      unsupportedMediaType: [415, 400],
    },

    // Known failures: the test is marked expected-to-fail (with this reason) and flags itself once fixed.
    // Keys are test ids "<category>:<service>:<operationId>:<case>" with "*" wildcards (see the report).
    // A known issue that does not reproduce passes with a "did not reproduce" annotation.
    knownIssues: {
      // Real defects in the public Petstore demo found by the generated suites (remove with the sample API).
      'security:petstore:*:auth-required': 'Petstore demo does not enforce authentication',
      'security:petstore:*:invalid-credentials': 'Petstore demo does not enforce authentication',
      'security:petstore:*:error-leakage': 'Error messages expose Java class names (io.swagger.petstore.model.*)',
      'security:petstore:uploadFile:injection-*': 'Upload response exposes server temp file paths (/tmp/inflector…)',
      'security:petstore:_service:security-headers': 'X-Content-Type-Options: nosniff is not sent',
      'negative:petstore:*:body-empty-body': 'An empty body returns 500 instead of 400',
      'negative:petstore:*:body-*-missing-required-field': 'Required fields are not enforced',
      'negative:petstore:*:body-*-null-for-required-field': 'Required fields are not enforced',
      'negative:petstore:*:body-*-value-outside-enum': 'Enum values are not enforced',
      'negative:petstore:*:body-*-wrong-type-expected-string': 'Numbers are silently coerced to strings',
      'negative:petstore:delete*:not-found': 'DELETE of a missing resource returns 200 instead of 404',
      'boundary:petstore:*:body-*-decimal': 'Decimals are accepted for integer fields',
      'positive:petstore:addPet:required-fields-only': 'Creating a pet without an id returns 500',
      'positive:petstore:updatePetWithForm:happy-path': 'Spec marks "name" optional, server requires it',
      'contract:petstore:findPetsBy*:matches-spec': 'Shared demo data contains pets without the required photoUrls',
      'positive:petstore:findPetsBy*:happy-path': 'Shared demo data contains pets without the required photoUrls',
    },

    boundary: { longStringLength: 10_000, largeArrayLength: 500 },

    security: {
      enabledEnvs: ['dev', 'qa', 'stage'], // never runs attack payloads anywhere else
      injection: true,
      oversizedPayloadKb: 512,
      sensitiveFields: ['password', 'passwd', 'secret', 'ssn', 'cardNumber', 'cvv', 'pin', 'privateKey', 'apiKey'],
      requiredHeaders: { 'x-content-type-options': 'nosniff' },
      // Authorisation checks need extra identities from services.<name>.authProfiles:
      roleChecks: [], // e.g. [{ service: 'petstore', profile: 'readonly', operations: ['addPet', 'deletePet'] }]
      idor: null, // e.g. { owner: 'default', attacker: 'otherUser' } — attacker must not read owner's resources
      rateLimit: { enabled: false, operation: null, requests: 50 }, // expects a 429 within N rapid calls
    },

    resilience: { concurrency: 5 },

    performance: {
      maxResponseMs: envInt('SLA_MS', 3_000), // p95 budget per operation
      samples: 5,
      perOperation: {}, // e.g. { 'petstore:findPetsByStatus': 1500 }
    },
  },

  logging: {
    level: env('LOG_LEVEL', 'info'), // debug | info | warn | error | silent
    attachToReport: true,
    maskHeaders: ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'api_key', 'proxy-authorization'],
    maskFields: [
      'password',
      'secret',
      'token',
      'accessToken',
      'access_token',
      'refresh_token',
      'clientSecret',
      'client_secret',
    ],
    maxBodyChars: 50_000,
  },

  run: {
    workers: envInt('WORKERS', undefined),
    retries: envInt('TEST_RETRIES', process.env.CI ? 1 : 0),
    testTimeoutMs: envInt('TEST_TIMEOUT_MS', 60_000),
  },

  report: {
    htmlOpen: env('REPORT_OPEN', 'never'), // always | never | on-failure
    chat: {
      provider: env('CHAT_PROVIDER', 'slack'), // slack | teams
      webhookUrl: env('CHAT_WEBHOOK_URL'),
      onlyOnFailure: envBool('CHAT_ONLY_ON_FAILURE', false),
      dryRun: envBool('CHAT_DRY_RUN', false), // print the payload instead of sending it
      reportUrl: env('REPORT_URL'), // link to the hosted HTML report, e.g. a CI artifact URL
      maxFailuresListed: 10,
    },
  },
};
