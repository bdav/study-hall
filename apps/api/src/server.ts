import { createApp } from './app.js';
import { listenHost } from './listenHost.js';
import { createErrorReporter, jsonLinesLogger } from './observability.js';

const port = Number(process.env.PORT) || 3001;
const host = listenHost(process.env);

const app = createApp({
  log: jsonLinesLogger,
  reportError: createErrorReporter(),
});

const onListening = () => {
  console.log(`API listening on http://${host ?? 'localhost'}:${port}`);
};
if (host) app.listen(port, host, onListening);
else app.listen(port, onListening);
