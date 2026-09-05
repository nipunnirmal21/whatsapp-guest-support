function createMaintenanceService({
  findOpenMaintenanceCase,
  insertMaintenanceCase,
  logger,
}) {
  async function ensureMaintenanceCase({
    conversationId,
    apartmentId,
    description,
  }) {
    if (!conversationId) throw new Error('conversationId is required');

    // The current schema requires an apartment. Never attach a provisional or
    // fabricated apartment when reservation identity has not been verified.
    if (!apartmentId) {
      logger.info('Maintenance case skipped until apartment identity is verified', {
        conversationId,
      });
      return { maintenanceCase: null, created: false, skipped: true };
    }

    const trimmedDescription =
      typeof description === 'string' ? description.trim().slice(0, 2000) : '';

    if (!trimmedDescription) throw new Error('Maintenance description is required');

    const existing = await findOpenMaintenanceCase({
      conversationId,
      apartmentId,
      description: trimmedDescription,
    });

    if (existing) {
      logger.info('Open maintenance case reused', {
        conversationId,
        maintenanceCaseId: existing.id,
      });
      return { maintenanceCase: existing, created: false, skipped: false };
    }

    const maintenanceCase = await insertMaintenanceCase({
      conversation_id: conversationId,
      apartment_id: apartmentId,
      description: trimmedDescription,
    });

    logger.info('Maintenance case created', {
      conversationId,
      maintenanceCaseId: maintenanceCase.id,
    });

    return { maintenanceCase, created: true, skipped: false };
  }

  return { ensureMaintenanceCase };
}

let defaultService;

function getDefaultService() {
  if (defaultService) return defaultService;

  const supabase = require('../../db/client');
  const logger = require('../../utils/logger');

  defaultService = createMaintenanceService({
    logger,
    async findOpenMaintenanceCase({ conversationId, apartmentId, description }) {
      const { data, error } = await supabase
        .from('maintenance_cases')
        .select('id, conversation_id, apartment_id, category, severity, status, description, created_at')
        .eq('conversation_id', conversationId)
        .eq('apartment_id', apartmentId)
        .eq('description', description)
        .in('status', ['open', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`Failed to find maintenance case: ${error.message}`);
      return data ?? null;
    },
    async insertMaintenanceCase(payload) {
      const { data, error } = await supabase
        .from('maintenance_cases')
        .insert(payload)
        .select('id, conversation_id, apartment_id, category, severity, status, description, created_at')
        .single();

      if (error) throw new Error(`Failed to create maintenance case: ${error.message}`);
      return data;
    },
  });

  return defaultService;
}

module.exports = {
  createMaintenanceService,
  ensureMaintenanceCase: (...args) =>
    getDefaultService().ensureMaintenanceCase(...args),
};
