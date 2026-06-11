const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://yunwu.ai';

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export async function callOpenAIChat(
  systemPrompt: string,
  content: ContentPart[] | string
): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const userContent = typeof content === 'string'
    ? [{ type: 'text' as const, text: content }]
    : content;

  const res = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      stream: false,
      max_tokens: 16384,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI Chat API error ${res.status}: ${errText}`);
  }

  const rawText = await res.text();

  // Some proxies return SSE even with stream=false; parse the last data chunk
  let data: any;
  if (rawText.trim().startsWith('data:')) {
    const lines = rawText.split('\n').filter((l) => l.trim().startsWith('data:'));
    const lastDataLine = lines.filter((l) => !l.includes('[DONE]')).pop();
    if (lastDataLine) {
      const jsonStr = lastDataLine.replace(/^data:\s*/, '').trim();
      data = JSON.parse(jsonStr);
    } else {
      throw new Error(`Unexpected SSE response: ${rawText.substring(0, 500)}`);
    }
  } else {
    data = JSON.parse(rawText);
  }

  const text = data.choices?.[0]?.message?.content as string | undefined;
  if (text === undefined || text === null) {
    throw new Error(`Unexpected OpenAI Chat response: ${JSON.stringify(data).substring(0, 500)}`);
  }
  return text;
}
