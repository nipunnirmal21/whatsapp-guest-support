const OpenAI = require('openai');
const logger = require('../../utils/logger');

const VALID_CLASSIFICATIONS = new Set([
  'safe_reply',
  'clarification_needed',
  'human_handover',
]);

const SYSTEM_PROMPT = `You are an assistant for a short-term apartment rental company's WhatsApp guest support system.

Your job is to classify the guest message and draft a concise WhatsApp reply when it is safe to do so.

You will receive structured JSON context that may include:
- guest
- reservation
- apartment
- policy

STRICT RULES:
1. Never invent facts. Do not make up Wi-Fi details, addresses, times, fees, parking rules, or policies.
2. Only use information explicitly present in the provided context.
3. Use "human_handover" for refunds, compensation, cancellations outside policy, relocation, complaints, disputes, payment issues, maintenance emergencies, or anything requiring staff approval.
4. Use "human_handover" for early check-in or late check-out approval requests.
5. Use "clarification_needed" when the guest intent is unclear or essential reservation/apartment data is missing.
6. Use "safe_reply" only when you can answer accurately using the provided context without guessing.
7. Keep drafts friendly, professional, and under 500 characters.
8. Return ONLY valid JSON. No markdown, no prose outside JSON.

Return JSON with exactly this shape:
{
  "classification": "safe_reply" | "clarification_needed" | "human_handover",
  "draft": "string or null"
}

Draft rules:
- For "safe_reply", draft must be a guest-ready WhatsApp message.
- For "clarification_needed", draft should politely ask for the missing detail.
- For "human_handover", draft may be null or a brief holding message such as "Thanks for your message. A member of our team will assist you shortly."`;

/**
 * Lazily create the OpenAI client so missing env vars fail inside classifyAndDraft.
 * @returns {OpenAI}
 */
function getOpenAIClient() {
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    throw new Error('LLM_API_KEY is not configured');
  }

  return new OpenAI({ apiKey });
}

/**
 * Builds a compact, model-safe context payload from the reservation lookup result.
 *
 * @param {object|null|undefined} context
 * @returns {object}
 */
function buildModelContext(context = {}) {
  return {
    guest: context.guest ?? null,
    reservation: context.reservation ?? null,
    apartment: context.apartment ?? null,
    policy: context.policy ?? null,
  };
}

/**
 * Parses and validates the model JSON response.
 *
 * @param {string} rawContent
 * @returns {{ classification: string, draft: string|null }}
 */
function parseModelResponse(rawContent) {
  let parsed;

  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    throw new Error(`LLM returned invalid JSON: ${err.message}`);
  }

  const classification = parsed?.classification;
  const draft =
    parsed?.draft === null || parsed?.draft === undefined
      ? null
      : String(parsed.draft).trim();

  if (!VALID_CLASSIFICATIONS.has(classification)) {
    throw new Error(`LLM returned invalid classification: ${classification}`);
  }

  if (classification === 'safe_reply' && !draft) {
    throw new Error('LLM returned safe_reply without a draft message');
  }

  return {
    classification,
    draft: draft || null,
  };
}

/**
 * classifyAndDraft
 * Calls the LLM only after the rules engine returns "unhandled".
 *
 * @param {string} guestText - raw guest message
 * @param {object} context   - { guest, reservation, apartment, policy }
 * @returns {Promise<{ classification: string, draft: string|null }>}
 */
async function classifyAndDraft(guestText, context = {}) {
  const trimmedText = (guestText ?? '').trim();

  if (!trimmedText) {
    logger.info('Classifier received empty guest text');
    return {
      classification: 'clarification_needed',
      draft: 'Could you please share a few more details so we can help you?',
    };
  }

  try {
    const openai = getOpenAIClient();
    const model = process.env.LLM_MODEL || 'gpt-4o';
    const modelContext = buildModelContext(context);

    const response = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            guest_message: trimmedText,
            context: modelContext,
          }),
        },
      ],
    });

    const rawContent = response.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error('LLM returned an empty response');
    }

    const result = parseModelResponse(rawContent);

    logger.info('Guest message classified by LLM', {
      classification: result.classification,
      hasDraft: Boolean(result.draft),
      model,
    });

    return result;
  } catch (err) {
    logger.error('LLM classification failed', {
      error: err.message,
      stack: err.stack,
    });

    return {
      classification: 'human_handover',
      draft: 'Thanks for your message. A member of our team will assist you shortly.',
    };
  }
}

module.exports = { classifyAndDraft };
