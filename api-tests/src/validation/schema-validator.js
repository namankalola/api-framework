import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// OpenAPI annotations that are not JSON Schema keywords.
const OPENAPI_KEYWORDS = ['example', 'xml', 'externalDocs', 'discriminator', 'x-nullable', 'x-faker'];

function createAjv(doc) {
  const AjvClass = String(doc.openapi ?? '').startsWith('3.1') ? Ajv2020 : Ajv;
  const ajv = new AjvClass({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  for (const keyword of OPENAPI_KEYWORDS) if (!ajv.getKeyword(keyword)) ajv.addKeyword(keyword);
  return ajv;
}

/** Find the documented response for a status: exact match, then "2XX" style, then "default". */
export function findResponse(operation, status) {
  const { responses } = operation;
  return (
    responses[String(status)] ??
    responses[`${String(status)[0]}XX`] ??
    responses[`${String(status)[0]}xx`] ??
    responses.default ??
    null
  );
}

const formatErrors = (errors = []) =>
  errors.map((e) => {
    const where = e.instancePath || '(root)';
    const detail = e.params?.additionalProperty
      ? ` "${e.params.additionalProperty}"`
      : e.params?.allowedValues
        ? ` ${JSON.stringify(e.params.allowedValues)}`
        : '';
    return `${where} ${e.message}${detail}`;
  });

/**
 * Validates payloads against OpenAPI schemas. One AJV instance per service; each schema is
 * compiled on first use and cached, so a 5,000-operation spec costs nothing until it is used.
 */
export class SchemaValidator {
  constructor(registry) {
    this.registry = registry;
    this.instances = new Map();
  }

  #ajv(service) {
    if (!this.instances.has(service)) {
      const ajv = createAjv(this.registry.doc(service));
      ajv.addSchema(this.registry.doc(service), service);
      this.instances.set(service, ajv);
    }
    return this.instances.get(service);
  }

  #compiled(service, pointer) {
    const validate = this.#ajv(service).getSchema(`${service}${pointer}`);
    if (!validate) throw new Error(`No schema at ${service}${pointer}`);
    return validate;
  }

  /** Validate a response body against the schema documented for its operation and status. */
  validateResponse(operation, status, body) {
    const response = findResponse(operation, status);
    if (!response) return { checked: false, valid: true, reason: `status ${status} is not documented`, errors: [] };
    if (!response.pointer) return { checked: false, valid: true, reason: 'no response schema documented', errors: [] };

    const validate = this.#compiled(operation.service, response.pointer);
    const valid = validate(body);
    return { checked: true, valid, errors: valid ? [] : formatErrors(validate.errors) };
  }

  /** Validate against a named component schema ("Pet") or an inline JSON schema object. */
  validate(service, schemaOrName, data) {
    const doc = this.registry.doc(service);
    let validate;
    if (typeof schemaOrName === 'string') {
      const base = doc.swagger === '2.0' ? '#/definitions/' : '#/components/schemas/';
      validate = this.#compiled(service, `${base}${schemaOrName}`);
    } else {
      validate = this.#ajv(service).compile(schemaOrName);
    }
    const valid = validate(data);
    return { checked: true, valid, errors: valid ? [] : formatErrors(validate.errors) };
  }
}
