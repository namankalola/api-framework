import { stripVTControlCharacters } from 'node:util';
import config, { TEST_ENV } from '../../config/index.js';

const EMOJI = { passed: '✅', failed: '❌', flaky: '⚠️' };

/**
 * Posts a run summary to Slack or Microsoft Teams (Workflows / incoming webhook).
 * Configured in config.report.chat; does nothing when no webhook is set and dryRun is off.
 */
export default class ChatReporter {
  constructor(options = {}) {
    this.options = { ...config.report.chat, ...options };
  }

  onBegin(_config, suite) {
    this.suite = suite;
    this.startedAt = Date.now();
  }

  printsToStdio() {
    return false;
  }

  #summarise(result) {
    const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    const failures = [];
    for (const test of this.suite.allTests()) {
      const outcome = test.outcome();
      if (outcome === 'expected') counts.passed += 1;
      else if (outcome === 'flaky') counts.flaky += 1;
      else if (outcome === 'skipped') counts.skipped += 1;
      else {
        counts.failed += 1;
        const last = test.results.at(-1);
        const error = stripVTControlCharacters(last?.error?.message ?? 'unknown error').split('\n')[0];
        failures.push(`${test.titlePath().slice(2).join(' › ')}: ${error}`);
      }
    }
    const status = counts.failed ? 'failed' : counts.flaky ? 'flaky' : 'passed';
    const duration = `${Math.round((Date.now() - this.startedAt) / 1000)}s`;
    return { status, counts, failures, duration, runStatus: result.status };
  }

  #slackPayload({ status, counts, failures, duration }) {
    const title = `${EMOJI[status]} API tests ${status.toUpperCase()} — ${TEST_ENV}`;
    const lines = [
      `*Passed:* ${counts.passed}   *Failed:* ${counts.failed}   *Flaky:* ${counts.flaky}   *Skipped:* ${counts.skipped}   *Duration:* ${duration}`,
      ...(failures.length
        ? ['*Failures:*', ...failures.slice(0, this.options.maxFailuresListed).map((f) => `• ${f}`)]
        : []),
      ...(this.options.reportUrl ? [`<${this.options.reportUrl}|Open HTML report>`] : []),
    ];
    return {
      text: title,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: title } },
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n').slice(0, 2900) } },
      ],
    };
  }

  #teamsPayload({ status, counts, failures, duration }) {
    const body = [
      {
        type: 'TextBlock',
        size: 'Large',
        weight: 'Bolder',
        text: `${EMOJI[status]} API tests ${status.toUpperCase()} — ${TEST_ENV}`,
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Passed', value: String(counts.passed) },
          { title: 'Failed', value: String(counts.failed) },
          { title: 'Flaky', value: String(counts.flaky) },
          { title: 'Skipped', value: String(counts.skipped) },
          { title: 'Duration', value: duration },
        ],
      },
      ...failures
        .slice(0, this.options.maxFailuresListed)
        .map((f) => ({ type: 'TextBlock', wrap: true, text: `• ${f}` })),
    ];
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body,
            actions: this.options.reportUrl
              ? [{ type: 'Action.OpenUrl', title: 'Open HTML report', url: this.options.reportUrl }]
              : [],
          },
        },
      ],
    };
  }

  async onEnd(result) {
    const { webhookUrl, dryRun, onlyOnFailure, provider } = this.options;
    if (!webhookUrl && !dryRun) return;

    const summary = this.#summarise(result);
    if (onlyOnFailure && summary.status === 'passed') return;
    const payload = provider === 'teams' ? this.#teamsPayload(summary) : this.#slackPayload(summary);

    if (dryRun || !webhookUrl) {
      console.log(`[chat-reporter] dry run (${provider}) payload:\n${JSON.stringify(payload, null, 2)}`);
      return;
    }
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) console.warn(`[chat-reporter] ${provider} webhook returned ${response.status}`);
    } catch (error) {
      console.warn(`[chat-reporter] could not post to ${provider}: ${error.message}`);
    }
  }
}
