import { createApp } from './app.js';
import { createErrorReporter, jsonLinesLogger } from './observability.js';

const port = process.env.PORT || 3001;

const app = createApp({
  log: jsonLinesLogger,
  reportError: createErrorReporter(),
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
