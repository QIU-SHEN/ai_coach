const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://yunwu.ai';

export async function callOpenAIResponses(instructions: string, input: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const res = await fetch(`${OPENAI_BASE_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions,
      input,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  let text: string | undefined;

  // Responses API (yunwu.ai / gpt-5.4): text is in output items, may have reasoning items first
  if (Array.isArray(data.output)) {
    const messageItem = data.output.find((item: any) => item.type === 'message' && Array.isArray(item.content));
    text = messageItem?.content?.[0]?.text;
  }

  // Fallback to chat completions format
  if (!text) {
    text = data.choices?.[0]?.message?.content;
  }

  // Legacy fallback
  if (!text) {
    text = data.output?.[0]?.text as string | undefined;
  }

  if (!text) {
    console.error('[OpenAI unexpected format]', JSON.stringify(data, null, 2));
    throw new Error(`Unexpected OpenAI response format`);
  }
  return text;
}

export function extractJson<T>(text: string): T {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/gi, '')
    .trim();
  return JSON.parse(cleaned) as T;
}
