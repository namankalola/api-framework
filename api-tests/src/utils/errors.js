export class FrameworkError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class ConfigError extends FrameworkError {}
export class SpecError extends FrameworkError {}
export class AuthError extends FrameworkError {}
