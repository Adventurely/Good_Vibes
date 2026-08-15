# Good Vibes

A minimal Node.js HTTP server that serves a hello world page. No dependencies —
just the Node standard library.

## Requirements

- Node.js 18 or newer

## Running

```bash
npm start
```

Then open http://localhost:3000.

The port and bind address can be overridden with environment variables:

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

## Routes

| Route      | Response                          |
| ---------- | --------------------------------- |
| `/`        | The hello world HTML page         |
| `/healthz` | `{"status":"ok"}`                 |
| anything else | `404 Not Found`                |

## Tests

```bash
npm test
```

## Layout

```
public/index.html   the hello world page
src/app.js          request handler / routing
src/server.js       HTTP server entry point
test/server.test.js integration tests
```
