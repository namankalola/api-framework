/** One representative payload per attack family; each is injected into every string input. */
export const INJECTION_PAYLOADS = {
  'sql-injection': "' OR '1'='1' -- ",
  'sql-union': "1' UNION SELECT NULL,NULL,NULL-- ",
  'nosql-injection': '{"$gt": ""}',
  xss: '<script>alert("xss")</script>',
  'path-traversal': '../../../../etc/passwd',
  'command-injection': '; cat /etc/passwd #',
  'template-injection': '{{7*7}}${7*7}<%= 7*7 %>',
  'ldap-injection': '*)(uid=*))(|(uid=*',
  'crlf-injection': 'x\r\nX-Injected-Header: injected',
  'format-string': '%s%s%s%s%n',
};

/** Signs that a server leaked internals in a response. */
export const LEAK_PATTERNS = [
  [/at [\w$.]+\([\w$.-]+\.(java|kt|scala):\d+\)/, 'Java stack trace'],
  [/Traceback \(most recent call last\)/, 'Python traceback'],
  [/at .+ \(?(\/|[A-Z]:\\).+\.(m?js|ts):\d+:\d+\)?/, 'Node.js stack trace'],
  [/System\.[\w.]*Exception|\bat [\w.]+\.\w+\(.*\) in .+:line \d+/, '.NET stack trace'],
  [
    /SQLSTATE|ORA-\d{5}|PSQLException|SQLiteException|MySqlException|error in your SQL syntax|unterminated quoted string|syntax error at or near/i,
    'SQL error message',
  ],
  [/MongoServerError|MongoError|CastError: Cast to ObjectId/, 'MongoDB error message'],
  [/\b(?:[a-z][a-z0-9_]*\.){2,}[A-Z][A-Za-z0-9_]*\b/, 'internal class name'],
  [/(^|[\s"'[])\/(home|var|usr|opt|srv|app|tmp)\/[\w.-]+/, 'server file path'],
  [/<b>(Warning|Fatal error|Parse error)<\/b>:/, 'PHP error'],
  [/root:x:0:0:/, '/etc/passwd contents'],
];

/** Fields an attacker may try to set on create/update (mass assignment). */
export const PRIVILEGED_FIELDS = {
  isAdmin: true,
  admin: true,
  role: 'admin',
  roles: ['admin'],
  permissions: ['*'],
  verified: true,
};

export const SECURITY_HEADERS_HTTPS = { 'strict-transport-security': /max-age=\d+/ };

/** Return the names of leak patterns found in a response text. */
export const findLeaks = (text = '') => LEAK_PATTERNS.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
