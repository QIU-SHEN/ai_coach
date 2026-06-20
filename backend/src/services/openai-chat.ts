import { logger } from './logger';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://yunwu.ai';

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

const RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

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

  const startMs = Date.now();
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
      logger.warn(`[AI] retrying callOpenAIChat attempt=${attempt} model=${OPENAI_MODEL}`);
    }

    try {
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

      const rawText = await res.text();

      if (!res.ok) {
        if (RETRYABLE_STATUSES.has(res.status) && attempt < RETRY_ATTEMPTS - 1) {
          lastError = new Error(`OpenAI Chat API error ${res.status}: ${rawText.substring(0, 200)}`);
          continue;
        }
        if (rawText.trim().startsWith('<')) {
          const snippet = rawText.substring(0, 200).replace(/\s+/g, ' ');
          throw new Error(`OpenAI Chat API returned HTML (status ${res.status}): ${snippet}`);
        }
        throw new Error(`OpenAI Chat API error ${res.status}: ${rawText.substring(0, 500)}`);
      }

      // Check if response is HTML (sometimes proxy returns HTML even with 200)
      if (rawText.trim().startsWith('<')) {
        const snippet = rawText.substring(0, 200).replace(/\s+/g, ' ');
        throw new Error(`OpenAI Chat API returned HTML: ${snippet}`);
      }

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

      logger.info(`[AI] callOpenAIChat done model=${OPENAI_MODEL} durationMs=${Date.now() - startMs} responseLen=${text.length}`);
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Network-level errors (ECONNRESET etc.) are retryable
      if (attempt < RETRY_ATTEMPTS - 1 && isNetworkError(lastError)) continue;
      break;
    }
  }

  logger.error(`[AI] callOpenAIChat failed model=${OPENAI_MODEL} durationMs=${Date.now() - startMs}`, lastError);
  throw lastError;
}

function isNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes('fetch') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('network');
}
