import { logger } from './logger';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://yunwu.ai';

const RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export async function callOpenAIResponses(instructions: string, input: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const startMs = Date.now();
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
      logger.warn(`[AI] retrying callOpenAIResponses attempt=${attempt} model=${OPENAI_MODEL}`);
    }

    try {
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
        if (RETRYABLE_STATUSES.has(res.status) && attempt < RETRY_ATTEMPTS - 1) {
          lastError = new Error(`OpenAI API error ${res.status}: ${errText.substring(0, 200)}`);
          continue;
        }
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
        logger.error('[OpenAI unexpected format]', JSON.stringify(data, null, 2));
        throw new Error(`Unexpected OpenAI response format`);
      }

      logger.info(`[AI] callOpenAIResponses done model=${OPENAI_MODEL} durationMs=${Date.now() - startMs} responseLen=${text.length}`);
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_ATTEMPTS - 1 && isNetworkError(lastError)) continue;
      break;
    }
  }

  logger.error(`[AI] callOpenAIResponses failed model=${OPENAI_MODEL} durationMs=${Date.now() - startMs}`, lastError);
  throw lastError;
}

export function extractJson<T>(text: string): T {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/gi, '')
    .trim();
  return JSON.parse(cleaned) as T;
}

function isNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes('fetch') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('network');
}
