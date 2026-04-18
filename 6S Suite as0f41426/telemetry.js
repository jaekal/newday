// OpenTelemetry setup (optional, controlled by OTEL_ENABLED)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

let started = false;
export default async function initTelemetry() {
  if (started) return; started = true;
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
  const serviceName = process.env.OTEL_SERVICE_NAME || 'sixs-app';

  const sdk = new NodeSDK({
    resource: new Resource({ [SemanticResourceAttributes.SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  await sdk.start();

  const shutdown = async () => { try { await sdk.shutdown(); } catch {} };
  ['SIGINT','SIGTERM'].forEach((sig) => process.on(sig, shutdown));
}
