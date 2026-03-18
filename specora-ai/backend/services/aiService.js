const OpenAI = require('openai');

let openaiClient = null;

/**
 * Get or create the OpenAI client (lazy initialization)
 */
function getClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Analyze a meeting transcript using GPT-4 and extract structured documentation
 * @param {string} transcript - The meeting transcript text
 * @param {string} projectName - Name of the project/meeting
 * @returns {object} Parsed documentation object
 */
async function analyzeTranscript(transcript, projectName) {
  const client = getClient();

  const prompt = `You are a senior software requirements analyst. Analyze this meeting transcript for the project "${projectName}" and extract structured documentation.

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

  const response = await client.chat.completions.create({
    model: 'gpt-4',
    temperature: 0.3,
    max_tokens: 3000,
    messages: [
      {
        role: 'system',
        content:
          'You are a software requirements analyst. You always respond with valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '';

  // Parse the JSON response, stripping any markdown wrapping
  const cleaned = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    srs: parsed.srs || '',
    requirements: parsed.requirements || [],
    userStories: parsed.userStories || [],
    apiEndpoints: parsed.apiEndpoints || [],
    dbTables: parsed.dbTables || [],
    architecture: parsed.architecture || '',
  };
}

module.exports = {
  analyzeTranscript,
};
