import { expect as baseExpect } from '@playwright/test';
import { apiMatchers } from './validation/matchers.js';

export const expect = baseExpect.extend(apiMatchers);
