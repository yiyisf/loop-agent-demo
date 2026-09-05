import type { AppConfig } from '../../config.js';

/**
 * AI SDK telemetry options for one model call. Spans are only produced when a
 * telemetry integration (e.g. `@ai-sdk/otel`) is registered in the process and
 * OTEL_ENABLED is set; otherwise this explicitly opts out.
 */
export function telemetryFor(config: AppConfig, functionId: string) {
  return { isEnabled: config.OTEL_ENABLED, functionId };
}
