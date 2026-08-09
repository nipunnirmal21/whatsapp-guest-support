const DELIVERY_STATUS_PRESENTATION = Object.freeze({
  pending: { label: 'Sending...', tone: 'muted' },
  sent: { label: '✓ Sent', tone: 'muted' },
  delivered: { label: '✓✓ Delivered', tone: 'muted' },
  read: { label: '✓✓ Read', tone: 'success' },
  failed: { label: '⚠ Failed', tone: 'error' },
});

export function normaliseDeliveryStatus(value) {
  if (typeof value !== 'string') return null;
  const status = value.trim().toLowerCase();
  return DELIVERY_STATUS_PRESENTATION[status] ? status : null;
}

export function getDeliveryStatusPresentation(value) {
  const status = normaliseDeliveryStatus(value);
  return status ? { status, ...DELIVERY_STATUS_PRESENTATION[status] } : null;
}

