const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const {
  resolveReservationContext,
  resolveReservationContextByConversationId,
  validateAndNormalisePhone,
} = require('../../services/reservations/lookup');
const { runRulesEngine } = require('../../services/rules/engine');
const { classifyAndDraft } = require('../../services/ai/classifier');

const MAX_TEXT_LENGTH = 2000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validationError(res, message) {
  return res.status(400).json({ success: false, error: message });
}

function emptyResolution() {
  return {
    reservationContext: null,
    candidateReservationId: null,
    match: { status: 'unmatched', method: null, reason: 'no_context_identifier' },
  };
}

function buildResult(result, source, match) {
  return {
    success: true,
    data: {
      classification: result.classification,
      draft: result.draft,
      source,
      reservationMatch: {
        status: match.status,
        method: match.method,
        reason: match.reason,
      },
    },
  };
}

function createClassifyHandler({
  resolveByPhone = resolveReservationContext,
  resolveByConversationId = resolveReservationContextByConversationId,
  normalisePhone = validateAndNormalisePhone,
  runRules = runRulesEngine,
  classify = classifyAndDraft,
  serviceLogger = logger,
} = {}) {
  return async function classifyIntent(req, res, next) {
    try {
      const { text, conversationId, phoneNumber } = req.body ?? {};
      const trimmedText = typeof text === 'string' ? text.trim() : '';

      if (!trimmedText) {
        return validationError(res, '"text" is required and must be a non-empty string');
      }

      if (trimmedText.length > MAX_TEXT_LENGTH) {
        return validationError(
          res,
          `"text" must be ${MAX_TEXT_LENGTH} characters or fewer`
        );
      }

      const hasConversationId = conversationId !== undefined && conversationId !== null;
      const hasPhoneNumber = phoneNumber !== undefined && phoneNumber !== null;

      if (hasConversationId && hasPhoneNumber) {
        return validationError(
          res,
          'Provide either "conversationId" or "phoneNumber", not both'
        );
      }

      let resolution = emptyResolution();

      if (hasConversationId) {
        if (typeof conversationId !== 'string' || !UUID_RE.test(conversationId)) {
          return validationError(res, 'Invalid "conversationId"');
        }

        resolution = await resolveByConversationId(conversationId);

        if (!resolution) {
          return res.status(404).json({
            success: false,
            error: 'Conversation not found',
          });
        }
      } else if (hasPhoneNumber) {
        let normalisedPhone;

        try {
          normalisedPhone = normalisePhone(phoneNumber);
        } catch (err) {
          return validationError(res, err.message);
        }

        resolution = await resolveByPhone({
          phoneNumber: normalisedPhone,
          messageText: trimmedText,
        });
      }

      const reservationContext = resolution.reservationContext;
      const reservation = reservationContext?.reservation ?? null;
      const apartment = reservationContext?.apartment
        ? {
            ...reservationContext.apartment,
            policy: reservationContext.policy ?? null,
          }
        : null;

      const rulesResult = await runRules(trimmedText, reservation, apartment);

      if (
        resolution.match.status === 'verified' &&
        rulesResult.outcome === 'auto_reply' &&
        rulesResult.reply
      ) {
        serviceLogger.info('Intent classified by rules engine', {
          classification: 'safe_reply',
          reservationMatchStatus: resolution.match.status,
          reservationMatchMethod: resolution.match.method,
        });

        return res.status(200).json(
          buildResult(
            { classification: 'safe_reply', draft: rulesResult.reply },
            'rules',
            resolution.match
          )
        );
      }

      const aiContext = {
        ...(reservationContext ?? {}),
        identity_verification: {
          status: resolution.match.status,
          method: resolution.match.method,
          reason: resolution.match.reason,
        },
      };
      const aiResult = await classify(trimmedText, aiContext);

      serviceLogger.info('Intent classified by AI endpoint', {
        classification: aiResult.classification,
        hasDraft: Boolean(aiResult.draft),
        reservationMatchStatus: resolution.match.status,
        reservationMatchMethod: resolution.match.method,
      });

      return res
        .status(200)
        .json(buildResult(aiResult, 'ai', resolution.match));
    } catch (err) {
      next(err);
    }
  };
}

/**
 * POST /api/intents/classify
 * Internal, side-effect-free endpoint to classify raw guest message text.
 * Uses verified reservation context for deterministic rules, then falls back
 * to the AI classifier. It never sends a WhatsApp reply or creates escalation.
 *
 * Returns one of: safe_reply | clarification_needed | human_handover
 */
router.post('/classify', createClassifyHandler());

module.exports = router;
module.exports.MAX_TEXT_LENGTH = MAX_TEXT_LENGTH;
module.exports.createClassifyHandler = createClassifyHandler;
