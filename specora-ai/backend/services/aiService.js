const OpenAI = require('openai');

/**
 * Provider registry.
 *
 * Groq and OpenAI both speak the OpenAI chat-completions protocol, so a single
 * client implementation serves both — only the base URL, key, and model differ.
 * Add a provider here rather than branching through the analysis code.
 */
const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    baseURL: undefined, // SDK default
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    modelEnv: 'OPENAI_MODEL',
  },
  groq: {
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    modelEnv: 'GROQ_MODEL',
  },
};

/**
 * Resolve the active provider.
 * MOCK_AI=true still wins for backwards compatibility with existing .env files.
 */
function getProviderName() {
  if (process.env.MOCK_AI === 'true') return 'mock';

  const name = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  if (name === 'mock') return 'mock';
  if (PROVIDERS[name]) return name;

  console.warn(`Unknown AI_PROVIDER "${name}"; falling back to openai.`);
  return 'openai';
}

let cachedClient = null;
let cachedFor = null;

function getClient(providerName) {
  const cfg = PROVIDERS[providerName];
  const apiKey = process.env[cfg.apiKeyEnv];

  if (!apiKey) {
    const err = new Error(
      `${cfg.label} is selected as the AI provider but ${cfg.apiKeyEnv} is not set.`
    );
    err.statusCode = 503;
    throw err;
  }

  // Rebuild the client if the provider changed (e.g. between tests).
  if (!cachedClient || cachedFor !== providerName) {
    cachedClient = new OpenAI({ apiKey, baseURL: cfg.baseURL });
    cachedFor = providerName;
  }
  return cachedClient;
}

function mockAnalysis() {
  return {
    srs: 'Mock summary of the meeting transcript.',
    requirements: ['Mock requirement A', 'Mock requirement B'],
    userStories: ['As a tester, I want to run mock mode so that I avoid billing.'],
    apiEndpoints: [{ method: 'GET', path: '/mock', description: 'Mock endpoint' }],
    dbTables: [{ table: 'mock_table', columns: ['id', 'value'] }],
    architecture: 'Mock architecture recommendation.',
    summary: 'Mock summary',
    keyPoints: ['Point A', 'Point B'],
    actionItems: ['Follow up'],
    decisions: ['Approved'],
  };
}

function buildPrompt(transcript, projectName) {
  return `You are a senior software requirements analyst. Analyze this meeting transcript for the project "${projectName}" and extract structured documentation.

Return a JSON object with EXACTLY these keys:

{
  "srs": "A comprehensive 3-paragraph Software Requirements Specification summary",
  "requirements": ["Array of functional and non-functional requirement strings"],
  "userStories": ["Array of 4-6 user stories in 'As a [user], I want to [goal], so that [benefit]' format"],
  "apiEndpoints": [{"method": "GET/POST/PUT/DELETE", "path": "/api/...", "description": "What it does"}],
  "dbTables": [{"table": "table_name", "columns": ["col1", "col2", "col3"]}],
  "architecture": "A 2-paragraph system architecture summary with technology recommendations"
}

Meeting Transcript:
"""
${transcript}
"""

Respond ONLY with valid JSON. No markdown, no backticks, no explanation.`;
}

/**
 * Analyze a meeting transcript and extract structured documentation.
 * @param {string} transcript - The meeting transcript text
 * @param {string} projectName - Name of the project/meeting
 * @returns {object} Parsed documentation object
 */
async function analyzeTranscript(transcript, projectName) {
  const providerName = getProviderName();

  if (providerName === 'mock') {
    return mockAnalysis();
  }

  const cfg = PROVIDERS[providerName];
  const client = getClient(providerName);
  const model = process.env[cfg.modelEnv] || cfg.defaultModel;

  const request = {
    model,
    temperature: 0.3,
    max_tokens: 3000,
    messages: [
      {
        role: 'system',
        content: 'You are a software requirements analyst. You always respond with valid JSON only.',
      },
      { role: 'user', content: buildPrompt(transcript, projectName) },
    ],
  };

  let response;
  try {
    // JSON mode guarantees parseable output where the model supports it.
    response = await client.chat.completions.create({
      ...request,
      response_format: { type: 'json_object' },
    });
  } catch (error) {
    // Not every model on every provider supports response_format. Fall back to
    // plain completion + parsing rather than failing the whole request.
    const unsupported =
      error.status === 400 && /response_format|json_object/i.test(error.message || '');
    if (!unsupported) throw error;

    console.warn(`${cfg.label} model "${model}" rejected JSON mode; retrying without it.`);
    response = await client.chat.completions.create(request);
  }

  const text = response.choices[0]?.message?.content || '';

  // Parse the JSON response, stripping any markdown wrapping.
  // A malformed reply is a normal failure mode for an LLM, not a server bug —
  // surface it as a clear error instead of an unhandled exception.
  const cleaned = text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseError) {
    console.error('AI returned unparseable JSON:', cleaned.slice(0, 500));
    const err = new Error('The AI returned a malformed response. Please try analyzing again.');
    err.statusCode = 502;
    throw err;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('The AI returned an unexpected response shape.');
    err.statusCode = 502;
    throw err;
  }

  return {
    srs: parsed.srs || '',
    requirements: parsed.requirements || [],
    userStories: parsed.userStories || [],
    apiEndpoints: parsed.apiEndpoints || [],
    dbTables: parsed.dbTables || [],
    architecture: parsed.architecture || '',
  };
}

/** Describe the active provider (used by the health endpoint). */
function describeProvider() {
  const name = getProviderName();
  if (name === 'mock') return { provider: 'mock', model: null, configured: true };
  const cfg = PROVIDERS[name];
  return {
    provider: name,
    model: process.env[cfg.modelEnv] || cfg.defaultModel,
    configured: !!process.env[cfg.apiKeyEnv],
  };
}

module.exports = {
  analyzeTranscript,
  describeProvider,
};
