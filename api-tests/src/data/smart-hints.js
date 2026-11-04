/**
 * Map common property names to realistic Faker generators, so specs without `x-faker`
 * hints still produce believable data. First match wins; matching ignores case, "_" and "-".
 * Extend this list for your domain.
 */
const HINTS = [
  [/^e?mail(address)?$|email$/, 'internet.email'],
  [/^user(name)?$|^login$/, 'internet.username'],
  [/^firstname$|^givenname$/, 'person.firstName'],
  [/^lastname$|^surname$|^familyname$/, 'person.lastName'],
  [/^(full)?name$|^displayname$/, 'person.fullName'],
  [/password$/, 'internet.password'],
  [/phone(number)?$|^mobile$/, 'phone.number'],
  [/^(street|address(line)?1?)$/, 'location.streetAddress'],
  [/^city$/, 'location.city'],
  [/^state$|^province$/, 'location.state'],
  [/^country$/, 'location.country'],
  [/^countrycode$/, 'location.countryCode'],
  [/^(zip|postal)(code)?$/, 'location.zipCode'],
  [/^(company|organi[sz]ation)(name)?$/, 'company.name'],
  [/^(website|homepage|url)$/, 'internet.url'],
  [/(photo|image|avatar)url$/, 'image.url'],
  [/^currency(code)?$/, 'finance.currencyCode'],
  [/^iban$/, 'finance.iban'],
  [/^(title|subject)$/, 'lorem.sentence'],
  [/^(description|comment|notes?|bio)$/, 'lorem.paragraph'],
  [/^color$|^colour$/, 'color.human'],
];

const normalise = (name) => name.toLowerCase().replace(/[_-]/g, '');

/** Pick a Faker path for a string property, or null when the schema already constrains the value. */
export function hintFor(propertyName, schema) {
  if (!schema || schema.type !== 'string' || schema.enum || schema.const || schema.pattern || schema.faker) return null;
  if (schema.format && !['email', 'uri', 'url'].includes(schema.format)) return null;
  const key = normalise(propertyName);
  return HINTS.find(([pattern]) => pattern.test(key))?.[1] ?? null;
}

/** Return a copy of a resolved schema with `faker` keywords added from property names. */
export function applyHints(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(applyHints);

  const out = { ...schema };
  // File uploads and base64 fields: never generate an empty payload.
  if (out.type === 'string' && (out.format === 'binary' || out.format === 'byte') && !out.faker) {
    out.faker = { 'string.alphanumeric': [out.format === 'byte' ? 44 : 64] };
  }
  // Unbounded numbers default to positive: ids, quantities and amounts are rarely negative.
  const numeric = [out.type].flat().some((t) => t === 'integer' || t === 'number');
  if (
    numeric &&
    out.minimum === undefined &&
    out.exclusiveMinimum === undefined &&
    !out.enum &&
    out.const === undefined
  ) {
    out.minimum = 1;
  }
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([name, prop]) => {
        const hinted = applyHints(prop);
        const fakerPath = hintFor(name, hinted);
        return [name, fakerPath ? { ...hinted, faker: fakerPath } : hinted];
      }),
    );
  }
  for (const key of ['items', 'additionalProperties', 'not']) if (out[key]) out[key] = applyHints(out[key]);
  for (const key of ['allOf', 'anyOf', 'oneOf']) if (out[key]) out[key] = out[key].map(applyHints);
  if (out['x-faker']) out.faker = out['x-faker']; // explicit hint in the spec wins
  return out;
}
