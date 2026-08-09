const GLOBAL_SETTINGS_ID = 'global';
const DEFAULT_CACHE_TTL_MS = 30_000;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function normaliseSettings(row, emergencyDisabled, source = 'database') {
  const aiAutoReplyEnabled = Boolean(row.ai_auto_reply_enabled);
  const autoSendClarifications = Boolean(row.auto_send_clarifications);

  return {
    aiAutoReplyEnabled,
    autoSendClarifications,
    emergencyDisabled,
    effectiveAiAutoReplyEnabled:
      aiAutoReplyEnabled && !emergencyDisabled,
    effectiveAutoSendClarifications:
      autoSendClarifications && !emergencyDisabled,
    updatedAt: row.updated_at ?? null,
    source,
  };
}

function validatePatch(patch) {
  const allowed = new Set([
    'aiAutoReplyEnabled',
    'autoSendClarifications',
  ]);
  const keys = Object.keys(patch ?? {});

  if (keys.length === 0) {
    throw new Error('At least one automation setting is required');
  }

  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown automation setting: ${key}`);
    }
    if (typeof patch[key] !== 'boolean') {
      throw new Error(`${key} must be a boolean`);
    }
  }
}

function createAutomationSettingsService({
  loadSettingsRow,
  saveSettingsRow,
  emergencyDisabled = false,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = () => Date.now(),
  logger,
}) {
  let cache = null;
  let cacheExpiresAt = 0;

  function cacheRow(row) {
    cache = row;
    cacheExpiresAt = now() + cacheTtlMs;
  }

  async function getAutomationSettings({
    forceRefresh = false,
    failClosed = false,
  } = {}) {
    try {
      if (!forceRefresh && cache && now() < cacheExpiresAt) {
        return normaliseSettings(cache, emergencyDisabled, 'cache');
      }

      const row = await loadSettingsRow();
      if (!row) throw new Error('Global automation settings were not found');

      cacheRow(row);
      return normaliseSettings(row, emergencyDisabled, 'database');
    } catch (error) {
      if (!failClosed) throw error;

      logger.error('Automation settings unavailable; AI auto-send disabled', {
        error: error.message,
      });

      return normaliseSettings(
        {
          ai_auto_reply_enabled: false,
          auto_send_clarifications: false,
          updated_at: null,
        },
        emergencyDisabled,
        'fallback'
      );
    }
  }

  async function updateAutomationSettings(patch) {
    validatePatch(patch);

    const current = await getAutomationSettings({ forceRefresh: true });
    const row = await saveSettingsRow({
      aiAutoReplyEnabled:
        patch.aiAutoReplyEnabled ?? current.aiAutoReplyEnabled,
      autoSendClarifications:
        patch.autoSendClarifications ?? current.autoSendClarifications,
    });

    cacheRow(row);

    logger.info('Automation settings updated', {
      aiAutoReplyEnabled: row.ai_auto_reply_enabled,
      autoSendClarifications: row.auto_send_clarifications,
      emergencyDisabled,
    });

    return normaliseSettings(row, emergencyDisabled, 'database');
  }

  function clearCache() {
    cache = null;
    cacheExpiresAt = 0;
  }

  return {
    getAutomationSettings,
    updateAutomationSettings,
    clearCache,
  };
}

let defaultService;

function getDefaultService() {
  if (defaultService) return defaultService;

  const supabase = require('../../db/client');
  const logger = require('../../utils/logger');

  defaultService = createAutomationSettingsService({
    logger,
    emergencyDisabled: parseBoolean(
      process.env.AI_AUTO_REPLY_EMERGENCY_DISABLE,
      false
    ),
    async loadSettingsRow() {
      const { data, error } = await supabase
        .from('automation_settings')
        .select(
          'id, ai_auto_reply_enabled, auto_send_clarifications, updated_at'
        )
        .eq('id', GLOBAL_SETTINGS_ID)
        .single();

      if (error) {
        throw new Error(`Failed to load automation settings: ${error.message}`);
      }

      return data;
    },
    async saveSettingsRow({
      aiAutoReplyEnabled,
      autoSendClarifications,
    }) {
      const { data, error } = await supabase
        .from('automation_settings')
        .update({
          ai_auto_reply_enabled: aiAutoReplyEnabled,
          auto_send_clarifications: autoSendClarifications,
          updated_at: new Date().toISOString(),
        })
        .eq('id', GLOBAL_SETTINGS_ID)
        .select(
          'id, ai_auto_reply_enabled, auto_send_clarifications, updated_at'
        )
        .single();

      if (error) {
        throw new Error(`Failed to update automation settings: ${error.message}`);
      }

      return data;
    },
  });

  return defaultService;
}

module.exports = {
  GLOBAL_SETTINGS_ID,
  createAutomationSettingsService,
  validatePatch,
  getAutomationSettings: (...args) =>
    getDefaultService().getAutomationSettings(...args),
  updateAutomationSettings: (...args) =>
    getDefaultService().updateAutomationSettings(...args),
};
