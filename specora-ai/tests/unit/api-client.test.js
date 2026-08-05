/**
 * Loads the real frontend api.js in a fake browser environment and drives
 * transcribeAndWait against a scripted fetch. No network, no DOM library.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'frontend', 'api.js'),
  'utf8'
);

let pass = 0;
const failures = [];
const ok = (name, cond) => {
  if (cond) pass++;
  else failures.push(name);
};

/**
 * @param {Array} script - queued responses; each is {status, body} or
 *   {networkError: true}
 */
function loadApi(script) {
  const seen = { requests: [], redirected: false, cleared: false };

  const store = { specora_session: JSON.stringify({ token: 'TOK' }) };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    Date,
    Error,
    JSON,
    Promise,
    FormData: class {},
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      removeItem: (k) => {
        seen.cleared = true;
        delete store[k];
      },
    },
    window: {
      location: {
        hostname: 'localhost',
        pathname: '/index.html',
        origin: 'http://localhost',
        set href(v) {
          seen.redirected = true;
        },
        get href() {
          return '';
        },
      },
    },
    async fetch(url, options) {
      seen.requests.push({ url, method: (options && options.method) || 'GET', options });
      const next = script.shift();
      if (!next) throw new Error('fetch script exhausted for ' + url);
      if (next.networkError) throw new Error('network down');
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(next.body),
      };
    },
  };

  vm.createContext(sandbox);
  // `const API = ...` does not become a sandbox property, so take the module's
  // completion value instead.
  const API = vm.runInContext(API_SRC + '\nAPI;', sandbox);
  return { API, seen };
}

const accepted = { status: 202, body: { status: 'transcribing', done: false, transcript: '' } };
const working = { status: 200, body: { status: 'transcribing', done: false, transcript: '' } };
const finished = {
  status: 200,
  body: { status: 'transcribed', done: true, transcript: 'hello world' },
};

(async () => {
  // 1. Happy path: POST then poll until done.
  {
    const { API, seen } = loadApi([accepted, working, working, finished]);
    const progress = [];
    const text = await API.transcribeAndWait('M1', {
      intervalMs: 5,
      onProgress: (s) => progress.push(s),
    });
    ok('returns transcript text', text === 'hello world');
    ok('first call is a POST', seen.requests[0].method === 'POST');
    ok('subsequent calls are GETs', seen.requests.slice(1).every((r) => r.method === 'GET'));
    ok('polled until done', seen.requests.length === 4);
    ok('reported progress', progress.length === 4);
    ok('sends auth header', seen.requests[0].options.headers.Authorization === 'Bearer TOK');
  }

  // 2. Server-side job failure surfaces its reason.
  {
    const { API } = loadApi([
      accepted,
      { status: 200, body: { status: 'error', done: true, error: 'bad audio', transcript: '' } },
    ]);
    let message = null;
    try {
      await API.transcribeAndWait('M1', { intervalMs: 5 });
    } catch (e) {
      message = e.message;
    }
    ok('job failure rejects', message === 'bad audio');
  }

  // 3. Transient network blips mid-poll must not abort the job.
  {
    const { API } = loadApi([
      accepted,
      { networkError: true },
      { networkError: true },
      working,
      finished,
    ]);
    const text = await API.transcribeAndWait('M1', { intervalMs: 5 });
    ok('survives transient poll failures', text === 'hello world');
  }

  // 4. Sustained failure eventually gives up.
  {
    const script = [accepted];
    for (let i = 0; i < 12; i++) script.push({ networkError: true });
    const { API } = loadApi(script);
    let threw = false;
    try {
      await API.transcribeAndWait('M1', { intervalMs: 2 });
    } catch (e) {
      threw = true;
    }
    ok('gives up after repeated failures', threw);
  }

  // 5. An expired session must abort immediately, not retry 5x.
  {
    const { API, seen } = loadApi([
      accepted,
      { status: 401, body: { error: 'Invalid or expired token' } },
    ]);
    let threw = false;
    try {
      await API.transcribeAndWait('M1', { intervalMs: 5 });
    } catch (e) {
      threw = true;
    }
    ok('401 aborts polling', threw);
    ok('401 cleared the stored session', seen.cleared);
    ok('401 redirected to login', seen.redirected);
    ok('401 did not keep polling', seen.requests.length === 2);
  }

  // 5b. Legacy backend: status route returns no `done` flag.
  {
    const { API, seen } = loadApi([
      accepted,
      { status: 200, body: { status: 'transcribing', transcript: '' } },
      { status: 200, body: { status: 'transcribed', transcript: 'legacy text' } },
    ]);
    const text = await API.transcribeAndWait('M1', { intervalMs: 5, timeoutMs: 2000 });
    ok('terminal status without done flag finishes', text === 'legacy text');
    ok('did not keep polling past completion', seen.requests.length === 3);
  }

  // 5c. Legacy backend: the POST itself returned the finished transcript.
  {
    const { API, seen } = loadApi([
      {
        status: 200,
        body: { message: 'Transcription completed', status: 'transcribed', transcript: 'inline text' },
      },
    ]);
    const text = await API.transcribeAndWait('M1', { intervalMs: 5, timeoutMs: 2000 });
    ok('inline transcript from POST is used', text === 'inline text');
    ok('no polling needed', seen.requests.length === 1);
  }

  // 5d. A 202 that merely echoes status must NOT be mistaken for completion.
  {
    const { API } = loadApi([accepted, working, finished]);
    const text = await API.transcribeAndWait('M1', { intervalMs: 5 });
    ok('202 without transcript still polls', text === 'hello world');
  }

  // 6. Overall timeout.
  {
    const script = [accepted];
    for (let i = 0; i < 50; i++) script.push(working);
    const { API } = loadApi(script);
    let message = null;
    try {
      await API.transcribeAndWait('M1', { intervalMs: 5, timeoutMs: 40 });
    } catch (e) {
      message = e.message;
    }
    ok('times out with a useful message', /taking unusually long/.test(message || ''));
  }

  console.log(
    failures.length
      ? `\n${failures.length} FAILED:\n  - ${failures.join('\n  - ')}\n(${pass} passed)`
      : `\nall ${pass} client checks passed`
  );
  process.exit(failures.length ? 1 : 0);
})();
