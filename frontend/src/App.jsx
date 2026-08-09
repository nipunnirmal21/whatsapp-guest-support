import { useState, useEffect, useCallback } from 'react';
import {
  loadAutomationSettings,
  saveAutomationSettings,
} from './services/automationSettings.js';
import {
  takeOverEscalation,
  assignConversation,
  startManualMode,
  resumeAutomation,
  resolveConversation,
} from './services/handover.js';
import {
  getDeliveryStatusPresentation,
  normaliseDeliveryStatus,
} from './services/messageDelivery.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const DASHBOARD_API_KEY = import.meta.env.VITE_DASHBOARD_API_KEY || '';
const ADMIN_USER_ID = import.meta.env.VITE_ADMIN_USER_ID || '';

/**
 * Central authenticated fetch for all dashboard API calls.
 * Always sends X-API-Key from VITE_DASHBOARD_API_KEY.
 */
async function fetchWithAuth(path, options = {}) {
  const headers = new Headers(options.headers || {});

  if (DASHBOARD_API_KEY) {
    headers.set('X-API-Key', DASHBOARD_API_KEY);
  }

  if (ADMIN_USER_ID) {
    headers.set('X-Admin-User-Id', ADMIN_USER_ID);
  }

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = json.error || json.message || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.payload = json;
    throw err;
  }

  return json;
}

const NAV_ITEMS = [
  { id: 'inbox', label: 'Inbox', badge: null },
  { id: 'reservations', label: 'Reservations', badge: null },
  { id: 'escalations', label: 'Escalations', badge: null },
  { id: 'analytics', label: 'Analytics', badge: null },
  { id: 'settings', label: 'Settings', badge: null },
];

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return formatDate(dateStr);
}

function calculateNights(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  const start = new Date(checkin);
  const end = new Date(checkout);
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function mapConversationStatus(convStatus, resStatus) {
  if (convStatus === 'manual') return 'Manual';
  if (convStatus === 'escalated') return 'Escalated';
  if (convStatus === 'resolved') return 'Resolved';
  if (resStatus === 'checked_in') return 'Checked In';
  if (resStatus === 'checked_out') return 'Resolved';
  return 'Confirmed';
}

function mapMessage(msg) {
  let from = 'human';
  if (msg.direction === 'inbound' || msg.from === 'guest') {
    from = 'guest';
  } else if (msg.source === 'ai' || msg.from === 'ai') {
    from = 'ai';
  } else if (msg.source === 'system' || msg.from === 'system') {
    from = 'system';
  }

  return {
    id: msg.id,
    from,
    text: msg.content ?? msg.text ?? '',
    time: formatTime(msg.created_at) || msg.time || '',
    deliveryStatus: normaliseDeliveryStatus(
      msg.delivery_status ?? msg.deliveryStatus
    ),
    failureReason: msg.failure_reason ?? msg.failureReason ?? null,
    sentAt: msg.sent_at ?? null,
    deliveredAt: msg.delivered_at ?? null,
    readAt: msg.read_at ?? null,
    failedAt: msg.failed_at ?? null,
  };
}

function normalizeConversation(raw) {
  const reservation = raw.reservation ?? null;
  const guest = reservation?.guest ?? null;
  const apartment = reservation?.apartment ?? null;
  const messages = Array.isArray(raw.messages) ? raw.messages.map(mapMessage) : [];
  const lastMsg = messages.length > 0 ? messages[messages.length - 1].text : '';

  return {
    id: raw.id,
    guest: guest?.full_name ?? raw.guest_name ?? 'Guest',
    phone: guest?.phone_number ?? raw.guest_phone ?? '',
    apartment: apartment?.name ?? '—',
    bookingId: reservation?.booking_id ?? '—',
    checkIn: formatDate(reservation?.checkin_date),
    checkOut: formatDate(reservation?.checkout_date),
    status: mapConversationStatus(raw.status, reservation?.status),
    rawStatus: raw.status ?? 'open',
    priority: raw.status === 'escalated' || raw.status === 'manual' ? 'escalated' : 'normal',
    lastMessage: lastMsg || raw.ai_draft || 'No messages yet',
    time: formatRelativeTime(raw.last_message_at ?? raw.created_at),
    unread: raw.unread ?? 0,
    aiInsight: raw.ai_classification ?? '—',
    aiDraft: raw.ai_draft ?? null,
    assignedTo: raw.assigned_to ?? null,
    assigneeName: raw.assignee?.name ?? null,
    manualModeReason: raw.manual_mode_reason ?? null,
    messages,
    messagesLoaded: Array.isArray(raw.messages),
    reservation: {
      guests: raw.guest_count ?? 1,
      nights: calculateNights(reservation?.checkin_date, reservation?.checkout_date),
      rawStatus: reservation?.status ?? null,
      source: reservation?.booking_source ?? '—',
      total: raw.total ?? '—',
      policy: raw.policy ?? 'Checkout per house policy',
    },
  };
}

function normalizeEscalation(raw) {
  const conversation = raw.conversation ?? null;
  const reservation = conversation?.reservation ?? null;
  const guest = reservation?.guest ?? null;
  const apartment = reservation?.apartment ?? null;
  const statusMap = {
    pending: 'Pending',
    acknowledged: 'Acknowledged',
    resolved: 'Resolved',
  };

  return {
    id: raw.id,
    conversationId: raw.conversation_id ?? conversation?.id ?? null,
    guest: guest?.full_name ?? conversation?.guest_phone ?? 'Guest',
    apartment: apartment?.name ?? '—',
    title: conversation?.ai_classification || raw.reason || 'Escalated conversation',
    reason: raw.reason || 'Requires human handover',
    severity: /urgent|emergency|complaint/i.test(raw.reason || '') ? 'Urgent' : 'Normal',
    time: formatRelativeTime(raw.created_at),
    status: statusMap[raw.status] ?? 'Pending',
    rawStatus: raw.status ?? 'pending',
    assignedTo: raw.escalated_to ?? null,
    assigneeName: raw.assignee?.name ?? null,
  };
}

function mergeHandoverState(conversation, raw) {
  const rawStatus = raw?.status ?? conversation.rawStatus;
  const assignedTo = raw?.assigned_to ?? null;
  return {
    ...conversation,
    rawStatus,
    status: mapConversationStatus(rawStatus, conversation.reservation.rawStatus),
    priority: rawStatus === 'manual' || rawStatus === 'escalated' ? 'escalated' : 'normal',
    assignedTo,
    assigneeName: assignedTo
      ? raw?.assignee?.name ??
        (assignedTo === conversation.assignedTo ? conversation.assigneeName : null)
      : null,
    manualModeReason: raw?.manual_mode_reason ?? null,
  };
}

function filterConversationsBySearch(conversations, searchQuery) {
  const q = (searchQuery || '').trim().toLowerCase();
  if (!q) return conversations;

  return conversations.filter((c) => {
    const guest = (c.guest || '').toLowerCase();
    const phone = (c.phone || '').toLowerCase().replace(/\s/g, '');
    const queryDigits = q.replace(/\s/g, '');
    return guest.includes(q) || phone.includes(queryDigits);
  });
}

function computeAnalytics(conversations, escalations) {
  const totalBookings = conversations.length;
  const activeStays = conversations.filter(
    (c) => c.status === 'Checked In' || c.status === 'Confirmed'
  ).length;
  const openEscalations = escalations.filter(
    (e) => e.status === 'Pending' || e.status === 'Acknowledged'
  ).length;
  const resolved = conversations.filter((c) => c.status === 'Resolved').length;
  const escalated = conversations.filter(
    (c) => c.status === 'Escalated' || c.status === 'Manual'
  ).length;
  const open = conversations.filter(
    (c) => c.status !== 'Resolved' && c.status !== 'Escalated' && c.status !== 'Manual'
  ).length;

  const withAi = conversations.filter(
    (c) => c.aiInsight && c.aiInsight !== '—'
  ).length;
  const safeReply = conversations.filter(
    (c) => c.aiInsight === 'safe_reply'
  ).length;
  const aiResolutionRate =
    totalBookings === 0 ? 0 : Math.round((safeReply / totalBookings) * 100);

  const statusBars = [
    {
      label: 'Open',
      count: open,
      pct: totalBookings ? Math.round((open / totalBookings) * 100) : 0,
    },
    {
      label: 'Resolved',
      count: resolved,
      pct: totalBookings ? Math.round((resolved / totalBookings) * 100) : 0,
    },
    {
      label: 'Escalated',
      count: escalated,
      pct: totalBookings ? Math.round((escalated / totalBookings) * 100) : 0,
    },
    {
      label: 'AI tagged',
      count: withAi,
      pct: totalBookings ? Math.round((withAi / totalBookings) * 100) : 0,
    },
  ];

  return {
    totalBookings,
    activeStays,
    openEscalations,
    aiResolutionRate,
    safeReply,
    statusBars,
  };
}
function IconInbox() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
    </svg>
  );
}

function IconAlert() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16l4-4 4 4 5-6" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .53-.21 1.04-.59 1.4L4 17h5m6 0a3 3 0 0 1-6 0" />
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

const NAV_ICONS = {
  inbox: IconInbox,
  reservations: IconCalendar,
  escalations: IconAlert,
  analytics: IconChart,
  settings: IconSettings,
};

const HEADER_COPY = {
  inbox: {
    title: 'WhatsApp Inbox',
    subtitle: 'Manage guest conversations & reservations',
  },
  reservations: {
    title: 'Reservations',
    subtitle: 'All Serendib Vacation bookings across properties',
  },
  escalations: {
    title: 'Escalations',
    subtitle: 'Conversations requiring human handover',
  },
  analytics: {
    title: 'Analytics',
    subtitle: 'Performance and automation insights',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Dashboard and integration preferences',
  },
};

function StatusBadge({ status }) {
  const styles = {
    'Checked In': 'bg-[#C9A227]/15 text-[#C9A227] border-[#C9A227]/40',
    Confirmed: 'bg-white/10 text-white border-white/20',
    Escalated: 'bg-black text-[#C9A227] border-[#C9A227]/60',
    Manual: 'bg-[#C9A227] text-[#0B1F3A] border-[#C9A227]',
    Resolved: 'bg-[#132B4F] text-white/70 border-[#1E3A5F]',
    Pending: 'bg-[#C9A227]/10 text-[#C9A227] border-[#C9A227]/40',
    Acknowledged: 'bg-white/10 text-white border-white/20',
  };

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[status] ?? styles.Confirmed}`}>
      {status}
    </span>
  );
}

function SeverityBadge({ severity }) {
  const styles = {
    Urgent: 'bg-black text-[#C9A227] border-[#C9A227]',
    High: 'bg-[#C9A227]/20 text-[#C9A227] border-[#C9A227]/50',
    Normal: 'bg-white/5 text-white/70 border-white/20',
  };

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles[severity] ?? styles.Normal}`}>
      {severity}
    </span>
  );
}

function MessageMeta({ message, inverted = false }) {
  const delivery = getDeliveryStatusPresentation(message.deliveryStatus);
  const mutedClass = inverted ? 'text-[#0B1F3A]/40' : 'text-white/40';
  const statusClass = delivery?.tone === 'error'
    ? 'text-red-300'
    : delivery?.tone === 'success'
      ? inverted
        ? 'text-[#0B1F3A]/70'
        : 'text-[#C9A227]'
      : mutedClass;

  return (
    <div className={`mt-1 flex items-center justify-end gap-2 text-[10px] ${mutedClass}`}>
      <span>{message.time}</span>
      {delivery && (
        <span
          className={statusClass}
          title={delivery.status === 'failed' ? message.failureReason ?? 'Delivery failed' : undefined}
        >
          {delivery.label}
        </span>
      )}
    </div>
  );
}

function MessageBubble({ message }) {
  const isGuest = message.from === 'guest';
  const isSystem = message.from === 'system';
  const isAi = message.from === 'ai';
  const isHuman = message.from === 'human';

  if (isGuest) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[75%] rounded-2xl rounded-bl-sm border border-[#1E3A5F] bg-[#0B1F3A] px-4 py-3 text-sm text-white shadow-lg">
          <p>{message.text}</p>
          <span className="mt-1 block text-[10px] text-white/40">{message.time}</span>
        </div>
      </div>
    );
  }

  if (isSystem) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-[#C9A227]/30 bg-[#C9A227]/10 px-4 py-3 text-sm text-white shadow-lg">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#C9A227]">Auto Reply</span>
          <p>{message.text}</p>
          <MessageMeta message={message} />
        </div>
      </div>
    );
  }

  if (isAi) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-white/10 bg-white px-4 py-3 text-sm text-[#0B1F3A] shadow-lg">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#C9A227]">AI Draft</span>
          <p>{message.text}</p>
          <MessageMeta message={message} inverted />
        </div>
      </div>
    );
  }

  if (isHuman) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-br-sm border border-[#C9A227]/30 bg-[#C9A227]/10 px-4 py-3 text-sm text-white shadow-lg">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#C9A227]">Operator</span>
          <p>{message.text}</p>
          <MessageMeta message={message} />
        </div>
      </div>
    );
  }

  return null;
}

function ToggleSwitch({ enabled, onChange, label, description, disabled = false }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-5 py-4">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="mt-1 text-xs text-white/50">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
          enabled ? 'bg-[#C9A227]' : 'bg-[#1E3A5F]'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ${
            enabled ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-black">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#C9A227]/40 bg-[#0B1F3A] shadow-2xl shadow-[#C9A227]/10">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#C9A227]/30 border-t-[#C9A227]" />
      </div>
      <p className="mt-8 text-lg font-semibold tracking-wide text-[#C9A227]">
        Loading Serendib Vacation Data...
      </p>
      <p className="mt-2 text-xs uppercase tracking-[0.3em] text-white/30">Guest Support Dashboard</p>
    </div>
  );
}

function InboxView({
  conversations,
  selectedId,
  setSelectedId,
  replyText,
  setReplyText,
  handleSendMessage,
  sendError,
  messagesLoading,
  onEscalate,
  adminUsers,
  onAssignConversation,
  onStartManualMode,
  onResumeAutomation,
  escalateBusy,
  actionBusyId,
}) {
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const currentAdmin = adminUsers.find((user) => user.id === ADMIN_USER_ID);
  const assignableUsers = ['supervisor', 'admin'].includes(currentAdmin?.role)
    ? adminUsers
    : adminUsers.filter((user) => user.id === ADMIN_USER_ID);

  if (!selected) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center bg-[#132B4F]">
        <div className="text-center">
          <p className="text-sm font-medium text-white/60">
            {conversations.length === 0 ? 'No conversations yet' : 'No matching conversations'}
          </p>
          <p className="mt-2 text-xs text-white/40">
            {conversations.length === 0
              ? 'Guest messages will appear here when received via WhatsApp'
              : 'Try a different guest name or phone number'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="flex w-80 shrink-0 flex-col border-r border-[#1E3A5F] bg-[#0B1F3A]">
        <div className="border-b border-[#1E3A5F] px-4 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#C9A227]">Conversations</h3>
            <span className="rounded-full bg-[#132B4F] px-2 py-0.5 text-[10px] text-white/60">
              {conversations.length} active
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.map((convo) => {
            const isSelected = convo.id === selectedId;

            return (
              <button
                key={convo.id}
                type="button"
                onClick={() => setSelectedId(convo.id)}
                className={`w-full border-b border-[#1E3A5F]/60 px-4 py-4 text-left transition ${
                  isSelected
                    ? 'bg-[#132B4F] shadow-[inset_3px_0_0_0_#C9A227]'
                    : 'hover:bg-[#132B4F]/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">{convo.guest}</p>
                      {convo.priority === 'escalated' && (
                        <span className="shrink-0 rounded bg-black px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#C9A227]">
                          {convo.rawStatus === 'manual' ? 'Man' : 'Esc'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[#C9A227]/80">{convo.apartment}</p>
                    <p className="mt-2 truncate text-xs text-white/50">{convo.lastMessage}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[10px] text-white/40">{convo.time}</span>
                    {convo.unread > 0 && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#C9A227] text-[10px] font-bold text-[#0B1F3A]">
                        {convo.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col bg-[#132B4F]">
        <div className="flex items-center justify-between border-b border-[#1E3A5F] bg-[#0B1F3A] px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#C9A227] bg-[#132B4F] text-sm font-bold text-[#C9A227]">
              {selected.guest
                .split(' ')
                .map((n) => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase() || '?'}
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{selected.guest}</h3>
              <p className="text-xs text-white/50">{selected.phone}</p>
            </div>
           </div>
           <div className="flex items-center gap-2">
             <StatusBadge status={selected.status} />
            {selected.rawStatus === 'manual' ? (
              <button
                type="button"
                disabled={actionBusyId === selected.id}
                onClick={() => onResumeAutomation(selected)}
                className="rounded-lg border border-white/20 bg-[#132B4F] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition hover:border-[#C9A227] hover:text-[#C9A227] disabled:opacity-50"
              >
                Resume Automation
              </button>
            ) : selected.rawStatus !== 'resolved' ? (
              <button
                type="button"
                disabled={actionBusyId === selected.id}
                onClick={() => onStartManualMode(selected)}
                className="rounded-lg border border-white/20 bg-[#132B4F] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition hover:border-[#C9A227] hover:text-[#C9A227] disabled:opacity-50"
              >
                {selected.rawStatus === 'escalated' ? 'Take Over' : 'Manual Mode'}
              </button>
            ) : null}
            {selected.rawStatus !== 'manual' &&
              selected.rawStatus !== 'escalated' &&
              selected.rawStatus !== 'resolved' && (
                <button
                  type="button"
                  disabled={escalateBusy}
                  onClick={() => onEscalate(selected)}
                  className="rounded-lg border border-[#C9A227] bg-[#C9A227] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[#0B1F3A] transition hover:bg-[#D4AF37] disabled:opacity-50"
                >
                  Escalate
                </button>
              )}
          </div>
        </div>

        {(selected.rawStatus === 'manual' || selected.rawStatus === 'escalated') && (
          <div className="border-b border-[#C9A227]/30 bg-black px-6 py-2 text-center text-xs text-[#C9A227]">
            {selected.rawStatus === 'manual'
              ? `Manual mode active${selected.assigneeName ? ` - ${selected.assigneeName}` : ''}. AI and rules auto-replies are paused.`
              : 'Awaiting human takeover. AI and rules auto-replies are paused.'}
          </div>
        )}

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-2xl rounded-xl border border-[#1E3A5F] bg-[#0B1F3A]/50 px-4 py-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">
              {selected.apartment}
            </p>
          </div>

          {messagesLoading ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#C9A227]/30 border-t-[#C9A227]" />
            </div>
          ) : selected.messages.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/40">No messages in this conversation yet</p>
          ) : (
            selected.messages.map((msg) => (
              <div key={msg.id} className="mx-auto max-w-2xl">
                <MessageBubble message={msg} />
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[#1E3A5F] bg-[#0B1F3A] px-6 py-4">
          {sendError && (
            <p className="mx-auto mb-3 max-w-2xl rounded-lg border border-[#C9A227]/40 bg-black px-4 py-2 text-center text-xs text-[#C9A227]">
              {sendError}
            </p>
          )}
          <div className="mx-auto flex max-w-2xl items-end gap-3">
            <textarea
              rows={2}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Type your reply to the guest..."
              className="flex-1 resize-none rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
            />
            <button
              type="button"
              onClick={handleSendMessage}
              className="shrink-0 rounded-xl bg-[#C9A227] px-5 py-3 text-sm font-bold uppercase tracking-wide text-[#0B1F3A] shadow-lg shadow-[#C9A227]/20 transition hover:bg-[#D4AF37]"
            >
              Send
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-2xl text-center text-[10px] text-white/30">
            Replies are sent via WhatsApp Cloud API · Serendib Vacation
          </p>
        </div>
      </section>

      <aside className="hidden w-80 shrink-0 flex-col border-l border-[#1E3A5F] bg-[#0B1F3A] xl:flex">
        <div className="border-b border-[#1E3A5F] px-5 py-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[#C9A227]">Reservation</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="rounded-2xl border border-[#1E3A5F] bg-[#132B4F] p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-bold leading-snug text-white">{selected.apartment}</p>
                <p className="mt-1 text-xs text-white/50">Ref: {selected.bookingId}</p>
              </div>
              <div className="shrink-0 rounded-lg bg-[#C9A227]/15 px-2 py-1 text-[10px] font-bold uppercase text-[#C9A227]">
                {selected.reservation.source}
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex justify-between border-b border-[#1E3A5F] pb-3">
                <span className="text-xs text-white/50">Check-in</span>
                <span className="text-sm font-medium text-white">{selected.checkIn}</span>
              </div>
              <div className="flex justify-between border-b border-[#1E3A5F] pb-3">
                <span className="text-xs text-white/50">Check-out</span>
                <span className="text-sm font-medium text-white">{selected.checkOut}</span>
              </div>
              <div className="flex justify-between border-b border-[#1E3A5F] pb-3">
                <span className="text-xs text-white/50">Guests</span>
                <span className="text-sm font-medium text-white">{selected.reservation.guests}</span>
              </div>
              <div className="flex justify-between border-b border-[#1E3A5F] pb-3">
                <span className="text-xs text-white/50">Nights</span>
                <span className="text-sm font-medium text-white">{selected.reservation.nights}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-white/50">Total</span>
                <span className="text-sm font-bold text-[#C9A227]">{selected.reservation.total}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#C9A227]">House Policy</p>
            <p className="mt-2 text-sm text-white/80">{selected.reservation.policy}</p>
          </div>

          <div className="mt-4 space-y-2">
            {selected.rawStatus === 'manual' ? (
              <button
                type="button"
                disabled={actionBusyId === selected.id}
                onClick={() => onResumeAutomation(selected)}
                className="w-full rounded-xl border border-white/20 bg-[#132B4F] px-4 py-3 text-left text-sm font-medium text-white transition hover:border-[#C9A227] hover:text-[#C9A227] disabled:opacity-40"
              >
                Resume AI Automation
              </button>
            ) : selected.rawStatus !== 'resolved' ? (
              <button
                type="button"
                disabled={actionBusyId === selected.id}
                onClick={() => onStartManualMode(selected)}
                className="w-full rounded-xl border border-white/20 bg-[#132B4F] px-4 py-3 text-left text-sm font-medium text-white transition hover:border-[#C9A227] hover:text-[#C9A227] disabled:opacity-40"
              >
                {selected.rawStatus === 'escalated' ? 'Take Over Conversation' : 'Start Manual Mode'}
              </button>
            ) : null}
            {selected.rawStatus !== 'manual' &&
              selected.rawStatus !== 'escalated' &&
              selected.rawStatus !== 'resolved' && (
                <button
                  type="button"
                  disabled={escalateBusy}
                  onClick={() => onEscalate(selected)}
                  className="w-full rounded-xl border border-[#C9A227]/40 bg-black px-4 py-3 text-left text-sm font-medium text-[#C9A227] transition hover:bg-[#C9A227] hover:text-[#0B1F3A] disabled:opacity-40"
                >
                  Escalate to Supervisor
                </button>
              )}
          </div>

          <div className="mt-4 rounded-xl border border-[#1E3A5F] bg-[#132B4F] p-4">
            <label
              htmlFor="conversation-assignee"
              className="text-[10px] font-bold uppercase tracking-widest text-white/40"
            >
              Assigned Operator
            </label>
            <select
              id="conversation-assignee"
              value={selected.assignedTo ?? ''}
              disabled={
                selected.rawStatus === 'resolved' ||
                actionBusyId === selected.id ||
                assignableUsers.length === 0
              }
              onChange={(event) => onAssignConversation(selected, event.target.value)}
              className="mt-2 w-full rounded-lg border border-[#1E3A5F] bg-black px-3 py-2 text-sm text-white outline-none transition focus:border-[#C9A227] disabled:opacity-40"
            >
              <option value="" disabled>
                Unassigned
              </option>
              {assignableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.role})
                </option>
              ))}
            </select>
            {assignableUsers.length === 0 && (
              <p className="mt-2 text-[10px] text-[#C9A227]">
                Configure VITE_ADMIN_USER_ID to enable assignment.
              </p>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-[#1E3A5F] bg-black p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">AI Insight</p>
            <p className="mt-2 text-sm text-white/70">
              Guest intent detected:{' '}
              <span className="font-medium text-[#C9A227]">{selected.aiInsight}</span>
            </p>
            {selected.aiDraft && (
              <p className="mt-2 text-xs text-white/40">Draft: {selected.aiDraft}</p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function ReservationsView({ conversations }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#132B4F] p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#C9A227]">Serendib Vacation</p>
          <h3 className="mt-1 text-2xl font-bold text-white">All Bookings</h3>
          <p className="mt-1 text-sm text-white/50">
            {conversations.length} reservation{conversations.length !== 1 ? 's' : ''} shown
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1F3A] px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Checked In</p>
            <p className="text-lg font-bold text-[#C9A227]">
              {conversations.filter((c) => c.status === 'Checked In').length}
            </p>
          </div>
          <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1F3A] px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Confirmed</p>
            <p className="text-lg font-bold text-white">
              {conversations.filter((c) => c.status === 'Confirmed').length}
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#1E3A5F] bg-[#0B1F3A] shadow-2xl shadow-black/40">
        <div className="overflow-x-auto overflow-y-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-black">
              <tr className="border-b border-[#1E3A5F]">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">Guest Name</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">Apartment</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">Check-in</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">Check-out</th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">Status</th>
                <th className="px-6 py-4 text-right text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">Total Price</th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((booking, index) => (
                <tr
                  key={booking.id}
                  className={`border-b border-[#1E3A5F]/60 transition hover:bg-[#132B4F] ${
                    index % 2 === 0 ? 'bg-[#0B1F3A]/40' : 'bg-transparent'
                  }`}
                >
                  <td className="px-6 py-5">
                    <p className="text-sm font-semibold text-white">{booking.guest}</p>
                    <p className="mt-0.5 text-xs text-white/40">{booking.bookingId}</p>
                  </td>
                  <td className="max-w-xs px-6 py-5">
                    <p className="text-sm text-white/90">{booking.apartment}</p>
                    <p className="mt-0.5 text-xs text-[#C9A227]/70">{booking.reservation.source}</p>
                  </td>
                  <td className="px-6 py-5 text-sm text-white/80">{booking.checkIn}</td>
                  <td className="px-6 py-5 text-sm text-white/80">{booking.checkOut}</td>
                  <td className="px-6 py-5">
                    <StatusBadge status={booking.status} />
                  </td>
                  <td className="px-6 py-5 text-right">
                    <span className="text-sm font-bold text-[#C9A227]">{booking.reservation.total}</span>
                    <p className="mt-0.5 text-[10px] text-white/40">
                      {booking.reservation.nights} nights · {booking.reservation.guests} guests
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-[#1E3A5F] bg-black px-6 py-4">
          <p className="text-xs text-white/40">Showing all active Serendib Vacation reservations</p>
          <p className="text-xs font-medium text-[#C9A227]">Negombo · Panadura · Nuwara Eliya</p>
        </div>
      </div>
    </div>
  );
}

function EscalationsView({ tickets, loading, error, onTakeOver, onResolve, onViewConversation, actionBusyId }) {
  const pendingCount = tickets.filter((t) => t.status === 'Pending').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#132B4F] p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#C9A227]">Human Handover</p>
          <h3 className="mt-1 text-2xl font-bold text-white">Escalated Tickets</h3>
          <p className="mt-1 text-sm text-white/50">
            {pendingCount} ticket{pendingCount !== 1 ? 's' : ''} awaiting operator action
          </p>
        </div>
        <div className="rounded-xl border border-[#C9A227]/40 bg-black px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[#C9A227]">Priority Queue</p>
          <p className="text-lg font-bold text-white">{tickets.length} open</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[#C9A227]/40 bg-black px-4 py-3 text-sm text-[#C9A227]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#C9A227]/30 border-t-[#C9A227]" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-2xl border border-[#1E3A5F] bg-[#0B1F3A]">
          <p className="text-sm text-white/50">No open escalations</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              className={`rounded-2xl border bg-[#0B1F3A] p-6 shadow-xl transition ${
                ticket.status === 'Acknowledged'
                  ? 'border-white/20 opacity-70'
                  : 'border-[#1E3A5F] hover:border-[#C9A227]/40'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-bold text-white">{ticket.title}</h4>
                    <SeverityBadge severity={ticket.severity} />
                    <StatusBadge status={ticket.status} />
                  </div>
                  <p className="mt-2 text-sm text-[#C9A227]/90">
                    {ticket.guest} · {ticket.apartment}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-white/60">{ticket.reason}</p>
                  <p className="mt-3 text-[10px] uppercase tracking-widest text-white/30">
                    Escalated {ticket.time}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  {ticket.status === 'Pending' ? (
                    <button
                      type="button"
                      disabled={actionBusyId === ticket.id}
                      onClick={() => onTakeOver(ticket)}
                      className="rounded-xl border border-[#C9A227] bg-[#C9A227] px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-[#0B1F3A] shadow-lg shadow-[#C9A227]/20 transition hover:bg-[#D4AF37] disabled:opacity-50"
                    >
                      Take Over
                    </button>
                  ) : (
                    <span className="rounded-xl border border-white/20 bg-[#132B4F] px-5 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-white/50">
                      {ticket.assigneeName ? `Assigned to ${ticket.assigneeName}` : 'Assigned'}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={actionBusyId === ticket.id || ticket.status === 'Resolved'}
                    onClick={() => onResolve(ticket)}
                    className="rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-5 py-2.5 text-xs font-medium text-white/70 transition hover:border-[#C9A227]/30 hover:text-white disabled:opacity-40"
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    onClick={() => onViewConversation(ticket)}
                    className="rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-5 py-2.5 text-xs font-medium text-white/70 transition hover:border-[#C9A227]/30 hover:text-white"
                  >
                    View Conversation
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalyticsView({ conversations = [], escalations = [] }) {
  const stats = computeAnalytics(conversations, escalations);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#132B4F] p-6">
      <div className="mb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#C9A227]">Serendib Vacation</p>
        <h3 className="mt-1 text-2xl font-bold text-white">Performance Overview</h3>
        <p className="mt-1 text-sm text-white/50">Live metrics from current conversations & escalations</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#1E3A5F] bg-[#0B1F3A] p-6 shadow-xl">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Total Bookings</p>
          <p className="mt-3 text-3xl font-bold text-white">{stats.totalBookings}</p>
          <p className="mt-2 text-xs text-[#C9A227]">Conversations in inbox</p>
        </div>
        <div className="rounded-2xl border border-[#1E3A5F] bg-[#0B1F3A] p-6 shadow-xl">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Active Stays</p>
          <p className="mt-3 text-3xl font-bold text-white">{stats.activeStays}</p>
          <p className="mt-2 text-xs text-[#C9A227]">Confirmed + checked in</p>
        </div>
        <div className="rounded-2xl border border-[#C9A227]/30 bg-black p-6 shadow-xl">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#C9A227]">AI Resolution Rate</p>
          <p className="mt-3 text-3xl font-bold text-[#C9A227]">{stats.aiResolutionRate}%</p>
          <p className="mt-2 text-xs text-white/50">
            {stats.safeReply} safe_reply · {stats.openEscalations} open escalations
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#1E3A5F] bg-[#0B1F3A] p-6 shadow-2xl shadow-black/40">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold uppercase tracking-widest text-[#C9A227]">Conversation Mix</h4>
            <p className="mt-1 text-xs text-white/50">Status breakdown from live dashboard data</p>
          </div>
        </div>

        <div className="flex h-64 items-end justify-between gap-3 rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-6 pb-6 pt-8">
          {stats.statusBars.map((bar) => (
            <div key={bar.label} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-xs font-bold text-white">{bar.count}</span>
              <div className="flex h-40 w-full items-end justify-center">
                <div
                  className="w-8 rounded-t-sm bg-[#C9A227] shadow-lg shadow-[#C9A227]/20"
                  style={{ height: `${Math.max(bar.pct, bar.count > 0 ? 8 : 0)}%` }}
                  title={`${bar.label}: ${bar.count} (${bar.pct}%)`}
                />
              </div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
                {bar.label}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-white/30">
          Computed from live conversations · Updates with polling
        </p>
      </div>
    </div>
  );
}

function SettingsView({
  aiAutoReply,
  setAiAutoReply,
  autoSendClarifications,
  setAutoSendClarifications,
  onSave,
  saveMessage,
  settingsLoading,
  settingsSaving,
  settingsError,
  emergencyDisabled,
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#132B4F] p-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#C9A227]">Configuration</p>
          <h3 className="mt-1 text-2xl font-bold text-white">Operator Preferences</h3>
          <p className="mt-1 text-sm text-white/50">
            Dashboard preferences for Serendib Vacation guest support. Secrets stay on the server.
          </p>
        </div>

        <div className="space-y-6">
          <section>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#C9A227]">Automation</h4>
            <ToggleSwitch
              enabled={aiAutoReply}
              onChange={setAiAutoReply}
              disabled={settingsLoading || settingsSaving}
              label="AI Safe Replies"
              description="Automatically send safe AI drafts only when an active reservation is matched. Rules-based replies are controlled separately by the backend."
            />
            <div className="mt-3">
              <ToggleSwitch
                enabled={autoSendClarifications}
                onChange={setAutoSendClarifications}
                disabled={settingsLoading || settingsSaving}
                label="Clarification Questions"
                description="Automatically ask guests for missing booking or request details when the AI needs clarification."
              />
            </div>

            {emergencyDisabled && (
              <div className="mt-3 rounded-xl border border-[#C9A227]/50 bg-black px-4 py-3">
                <p className="text-xs font-semibold text-[#C9A227]">
                  Emergency override active
                </p>
                <p className="mt-1 text-xs text-white/50">
                  All AI automatic messages are forced off by the backend environment setting.
                </p>
              </div>
            )}

            {settingsError && (
              <div className="mt-3 rounded-xl border border-[#C9A227]/40 bg-black px-4 py-3 text-xs text-[#C9A227]">
                {settingsError}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-[#1E3A5F] bg-[#0B1F3A]/60 p-4">
            <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-[#C9A227]">
              Server secrets
            </h4>
            <p className="text-sm leading-relaxed text-white/50">
              Webhook verification tokens, Meta app secrets, OpenAI keys, and database credentials are
              configured only in the backend <code className="text-white/70">.env</code> file. This
              dashboard never collects or displays those values.
            </p>
          </section>

          <div className="flex items-center justify-between border-t border-[#1E3A5F] pt-6">
            {saveMessage ? (
              <p className="text-sm font-medium text-[#C9A227]">{saveMessage}</p>
            ) : (
              <p className="text-xs text-white/40">
                {settingsLoading
                  ? 'Loading automation settings...'
                  : 'Preferences are stored securely in the backend database.'}
              </p>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={settingsLoading || settingsSaving}
              className="rounded-xl bg-[#C9A227] px-6 py-3 text-sm font-bold uppercase tracking-wide text-[#0B1F3A] shadow-lg shadow-[#C9A227]/20 transition hover:bg-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {settingsSaving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activeNav, setActiveNav] = useState('inbox');
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [escalationTickets, setEscalationTickets] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [escalationsLoading, setEscalationsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [escalationsError, setEscalationsError] = useState(null);
  const [sendError, setSendError] = useState(null);
  const [escalateBusy, setEscalateBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [aiAutoReply, setAiAutoReply] = useState(false);
  const [autoSendClarifications, setAutoSendClarifications] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState(null);
  const [emergencyDisabled, setEmergencyDisabled] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const loadConversations = useCallback(async () => {
    const json = await fetchWithAuth('/api/conversations');
    const list = (json.data ?? []).map((item) =>
      normalizeConversation({ ...item, messages: item.messages ?? undefined })
    );
    // List endpoint has no messages — mark as not loaded
    return list.map((c) => ({ ...c, messages: [], messagesLoaded: false }));
  }, []);

  const loadEscalations = useCallback(async () => {
    const json = await fetchWithAuth('/api/escalations');
    return (json.data ?? [])
      .map(normalizeEscalation)
      .filter((t) => t.rawStatus !== 'resolved');
  }, []);

  const loadAdminUsers = useCallback(async () => {
    const json = await fetchWithAuth('/api/admin-users');
    return json.data ?? [];
  }, []);

  /** Merge list poll into state without wiping loaded message threads */
  const mergeConversationList = useCallback((incoming) => {
    setConversations((prev) => {
      const prevById = new Map(prev.map((c) => [c.id, c]));
      return incoming.map((c) => {
        const existing = prevById.get(c.id);
        if (existing?.messagesLoaded) {
          return {
            ...c,
            messages: existing.messages,
            messagesLoaded: true,
            lastMessage:
              existing.messages.length > 0
                ? existing.messages[existing.messages.length - 1].text
                : c.lastMessage,
          };
        }
        return c;
      });
    });
  }, []);

  const refreshDashboard = useCallback(async () => {
    const [convos, tickets, users] = await Promise.all([
      loadConversations(),
      loadEscalations(),
      loadAdminUsers(),
    ]);
    setConversations(convos);
    setEscalationTickets(tickets);
    setAdminUsers(users);
    return convos;
  }, [loadAdminUsers, loadConversations, loadEscalations]);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const convos = await refreshDashboard();
        if (cancelled) return;
        setError(null);
        if (convos.length > 0) {
          setSelectedId((prev) => prev ?? convos[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Network error — could not reach the backend');
          setConversations([]);
          setEscalationTickets([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [refreshDashboard]);

  // Load full conversation (messages + reservation) when selection changes
  useEffect(() => {
    if (!selectedId) return undefined;

    let cancelled = false;

    async function loadDetail() {
      setMessagesLoading(true);
      setSendError(null);
      try {
        const json = await fetchWithAuth(`/api/conversations/${selectedId}`);
        if (cancelled) return;
        const detailed = normalizeConversation(json.data);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? { ...detailed, messagesLoaded: true }
              : c
          )
        );
      } catch (err) {
        if (!cancelled) {
          setSendError(err.message || 'Failed to load conversation messages');
        }
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    }

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Auto-poll conversations every 5s; also poll selected conversation detail
  useEffect(() => {
    let cancelled = false;

    async function pollList() {
      try {
        const list = await loadConversations();
        if (cancelled) return;
        mergeConversationList(list);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          // Keep UI usable; surface soft error without blanking data
          setError(err.message || 'Polling failed — retrying…');
        }
      }
    }

    async function pollSelected() {
      if (!selectedId) return;
      try {
        const json = await fetchWithAuth(`/api/conversations/${selectedId}`);
        if (cancelled) return;
        const detailed = normalizeConversation(json.data);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId ? { ...detailed, messagesLoaded: true } : c
          )
        );
      } catch {
        // Ignore transient detail poll errors
      }
    }

    const listInterval = setInterval(pollList, 5000);
    const detailInterval = setInterval(pollSelected, 5000);

    return () => {
      cancelled = true;
      clearInterval(listInterval);
      clearInterval(detailInterval);
    };
  }, [selectedId, loadConversations, mergeConversationList]);

  // Refresh escalations when opening that tab
  useEffect(() => {
    if (activeNav !== 'escalations') return undefined;

    let cancelled = false;

    async function load() {
      setEscalationsLoading(true);
      setEscalationsError(null);
      try {
        const tickets = await loadEscalations();
        if (!cancelled) setEscalationTickets(tickets);
      } catch (err) {
        if (!cancelled) {
          setEscalationsError(err.message || 'Failed to load escalations');
        }
      } finally {
        if (!cancelled) setEscalationsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeNav, loadEscalations]);

  // Load server-controlled automation settings whenever the Settings tab opens.
  useEffect(() => {
    if (activeNav !== 'settings') return undefined;

    let cancelled = false;

    async function loadSettings() {
      setSettingsLoading(true);
      setSettingsError(null);
      setSaveMessage('');

      try {
        const settings = await loadAutomationSettings(fetchWithAuth);
        if (cancelled) return;

        setAiAutoReply(settings.aiAutoReplyEnabled);
        setAutoSendClarifications(settings.autoSendClarifications);
        setEmergencyDisabled(settings.emergencyDisabled);
      } catch (err) {
        if (!cancelled) {
          setSettingsError(
            err.message || 'Failed to load automation settings'
          );
        }
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, [activeNav]);

  const header = HEADER_COPY[activeNav] ?? HEADER_COPY.inbox;
  const filteredConversations = filterConversationsBySearch(conversations, searchQuery);
  const pendingEscalations = escalationTickets.filter((t) => t.status === 'Pending').length;
  const unreadCount = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
  const activeStays = conversations.filter(
    (c) => c.status === 'Checked In' || c.status === 'Confirmed'
  ).length;
  const currentAdminUser = adminUsers.find((user) => user.id === ADMIN_USER_ID) ?? null;
  const currentAdminName = currentAdminUser?.name ?? 'Operator not configured';
  const currentAdminInitials = currentAdminUser?.name
    ? currentAdminUser.name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?';

  async function handleSendMessage() {
    const trimmed = replyText.trim();
    if (!trimmed || !selectedId) return;

    const selected = conversations.find((c) => c.id === selectedId);
    if (!selected?.phone) {
      setSendError('Cannot send — guest phone number is missing');
      return;
    }

    setSendError(null);

    const optimisticId = `temp-${Date.now()}`;
    const newMessage = {
      id: optimisticId,
      from: 'human',
      text: trimmed,
      time: 'Just now',
      deliveryStatus: 'pending',
    };

    setConversations((prev) =>
      prev.map((convo) =>
        convo.id === selectedId
          ? {
              ...convo,
              messages: [...convo.messages, newMessage],
              lastMessage: trimmed,
              time: 'Just now',
            }
          : convo
      )
    );
    setReplyText('');

    try {
      // Persist + send WhatsApp via conversation reply endpoint
      // (POST /api/messages/send only dispatches WhatsApp and does not save to DB)
      const json = await fetchWithAuth(`/api/conversations/${selectedId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ content: trimmed }),
      });

      if (json.data) {
        const serverMessage = mapMessage(json.data);
        setConversations((prev) =>
          prev.map((convo) =>
            convo.id === selectedId
              ? {
                  ...convo,
                  messages: convo.messages.map((msg) =>
                    msg.id === optimisticId ? serverMessage : msg
                  ),
                  status: 'Manual',
                  rawStatus: 'manual',
                  priority: 'escalated',
                  assignedTo: ADMIN_USER_ID || convo.assignedTo,
                  assigneeName: currentAdminUser?.name ?? convo.assigneeName,
                }
              : convo
          )
        );
      }
    } catch (err) {
      setConversations((prev) =>
        prev.map((convo) => {
          if (convo.id !== selectedId) return convo;
          const remaining = convo.messages.filter((msg) => msg.id !== optimisticId);
          const previousLast = remaining[remaining.length - 1]?.text ?? 'No messages yet';
          return {
            ...convo,
            messages: remaining,
            lastMessage: previousLast,
          };
        })
      );
      setReplyText(trimmed);
      setSendError(err.message || 'Failed to send message. Please try again.');
    }
  }

  async function handleEscalate(conversation) {
    if (!conversation?.id || escalateBusy) return;
    setEscalateBusy(true);
    setSendError(null);
    try {
      await fetchWithAuth('/api/escalations/create', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: conversation.id,
          reason: conversation.aiInsight !== '—'
            ? `Operator escalate: ${conversation.aiInsight}`
            : 'Operator requested supervisor handover',
        }),
      });

      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversation.id
            ? { ...c, status: 'Escalated', priority: 'escalated', rawStatus: 'escalated' }
            : c
        )
      );

      const tickets = await loadEscalations();
      setEscalationTickets(tickets);
    } catch (err) {
      setSendError(err.message || 'Failed to escalate conversation');
    } finally {
      setEscalateBusy(false);
    }
  }

  async function handleTakeOver(ticket) {
    if (!ticket?.id || actionBusyId) return;
    setActionBusyId(ticket.id);
    setEscalationsError(null);

    try {
      const result = await takeOverEscalation(fetchWithAuth, ticket.id);
      const assigneeName = currentAdminUser?.name ?? null;

      setEscalationTickets((prev) =>
        prev.map((t) =>
          t.id === ticket.id
            ? {
                ...t,
                status: 'Acknowledged',
                rawStatus: 'acknowledged',
                assignedTo: result.escalation?.escalated_to ?? ADMIN_USER_ID,
                assigneeName,
              }
            : t
        )
      );

      if (ticket.conversationId) {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === ticket.conversationId
              ? { ...mergeHandoverState(conversation, result.conversation), assigneeName }
              : conversation
          )
        );
        setSelectedId(ticket.conversationId);
        setActiveNav('inbox');
      }
    } catch (err) {
      setEscalationsError(err.message || 'Failed to take over escalation');
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleStartManualMode(conversation) {
    if (!conversation?.id || actionBusyId) return;
    setActionBusyId(conversation.id);
    setSendError(null);

    try {
      const updated = await startManualMode(
        fetchWithAuth,
        conversation.id,
        conversation.rawStatus === 'escalated'
          ? 'Operator took over escalated conversation'
          : 'Operator started manual mode'
      );

      setConversations((prev) =>
        prev.map((item) =>
          item.id === conversation.id
            ? {
                ...mergeHandoverState(item, updated),
                assigneeName: currentAdminUser?.name ?? null,
              }
            : item
        )
      );
      setEscalationTickets((prev) =>
        prev.map((ticket) =>
          ticket.conversationId === conversation.id
            ? {
                ...ticket,
                status: 'Acknowledged',
                rawStatus: 'acknowledged',
                assignedTo: updated.assigned_to,
                assigneeName: currentAdminUser?.name ?? null,
              }
            : ticket
        )
      );
    } catch (err) {
      setSendError(err.message || 'Failed to start manual mode');
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleAssignConversation(conversation, assignedTo) {
    if (!conversation?.id || !assignedTo || actionBusyId) return;
    setActionBusyId(conversation.id);
    setSendError(null);

    try {
      const updated = await assignConversation(
        fetchWithAuth,
        conversation.id,
        assignedTo
      );
      const assigneeName = adminUsers.find((user) => user.id === assignedTo)?.name ?? null;

      setConversations((prev) =>
        prev.map((item) =>
          item.id === conversation.id
            ? { ...mergeHandoverState(item, updated), assigneeName }
            : item
        )
      );
      setEscalationTickets((prev) =>
        prev.map((ticket) =>
          ticket.conversationId === conversation.id
            ? {
                ...ticket,
                status: 'Acknowledged',
                rawStatus: 'acknowledged',
                assignedTo,
                assigneeName,
              }
            : ticket
        )
      );
    } catch (err) {
      setSendError(err.message || 'Failed to assign conversation');
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleResumeAutomation(conversation) {
    if (!conversation?.id || actionBusyId) return;
    setActionBusyId(conversation.id);
    setSendError(null);

    try {
      const updated = await resumeAutomation(fetchWithAuth, conversation.id);
      setConversations((prev) =>
        prev.map((item) =>
          item.id === conversation.id ? mergeHandoverState(item, updated) : item
        )
      );
      setEscalationTickets((prev) =>
        prev.filter((ticket) => ticket.conversationId !== conversation.id)
      );
    } catch (err) {
      setSendError(err.message || 'Failed to resume automation');
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleResolve(ticket) {
    if (!ticket.conversationId) return;
    setActionBusyId(ticket.id);
    setEscalationsError(null);
    try {
      const updated = await resolveConversation(fetchWithAuth, ticket.conversationId);
      setEscalationTickets((prev) => prev.filter((t) => t.id !== ticket.id));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === ticket.conversationId
            ? mergeHandoverState(c, updated)
            : c
        )
      );
    } catch (err) {
      setEscalationsError(err.message || 'Failed to resolve escalation');
    } finally {
      setActionBusyId(null);
    }
  }

  function handleViewConversation(ticket) {
    if (ticket.conversationId) {
      setSelectedId(ticket.conversationId);
      setActiveNav('inbox');
    }
  }

  async function handleSaveSettings() {
    if (settingsLoading || settingsSaving) return;

    setSettingsSaving(true);
    setSettingsError(null);
    setSaveMessage('');

    try {
      const settings = await saveAutomationSettings(fetchWithAuth, {
        aiAutoReplyEnabled: aiAutoReply,
        autoSendClarifications,
      });

      setAiAutoReply(settings.aiAutoReplyEnabled);
      setAutoSendClarifications(settings.autoSendClarifications);
      setEmergencyDisabled(settings.emergencyDisabled);
      setSaveMessage('Automation preferences saved.');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      setSettingsError(err.message || 'Failed to save automation settings');
    } finally {
      setSettingsSaving(false);
    }
  }

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-black font-sans text-white antialiased">
      <aside className="flex w-64 shrink-0 flex-col border-r border-[#1E3A5F] bg-[#0B1F3A]">
        <div className="border-b border-[#1E3A5F] px-6 py-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C9A227] text-[#0B1F3A] shadow-lg shadow-[#C9A227]/20">
              <IconWhatsApp />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide text-white">Serendib Vacation</h1>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#C9A227]">Guest Support</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-6">
          {NAV_ITEMS.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const isActive = activeNav === item.id;
            const badge =
              item.id === 'escalations'
                ? pendingEscalations > 0
                  ? String(pendingEscalations)
                  : null
                : item.id === 'inbox'
                  ? unreadCount > 0
                    ? String(unreadCount)
                    : null
                  : item.badge;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-[#C9A227] text-[#0B1F3A] shadow-lg shadow-[#C9A227]/25'
                    : 'text-white/70 hover:bg-[#132B4F] hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon />
                  {item.label}
                </span>
                {badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isActive ? 'bg-[#0B1F3A]/20 text-[#0B1F3A]' : 'bg-[#C9A227] text-[#0B1F3A]'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#1E3A5F] p-4">
          <div className="rounded-xl border border-[#1E3A5F] bg-[#132B4F] p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#C9A227]">Live Stats</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xl font-bold text-white">{activeStays}</p>
                <p className="text-[10px] text-white/50">Active Stays</p>
              </div>
              <div>
                <p className="text-xl font-bold text-[#C9A227]">{pendingEscalations}</p>
                <p className="text-[10px] text-white/50">Open Escalations</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#1E3A5F] bg-[#0B1F3A] px-6">
          <div>
            <h2 className="text-lg font-semibold text-white">{header.title}</h2>
            <p className="text-xs text-white/50">{header.subtitle}</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
                <IconSearch />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search guests, phone..."
                className="w-72 rounded-xl border border-[#1E3A5F] bg-[#132B4F] py-2 pl-10 pr-4 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
              />
            </div>

            <button
              type="button"
              className="relative rounded-xl border border-[#1E3A5F] bg-[#132B4F] p-2.5 text-white/70 transition hover:border-[#C9A227]/50 hover:text-[#C9A227]"
            >
              <IconBell />
              {pendingEscalations > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#C9A227] text-[9px] font-bold text-[#0B1F3A]">
                  {pendingEscalations}
                </span>
              )}
            </button>

            <div className="flex items-center gap-3 rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#C9A227] text-xs font-bold text-[#0B1F3A]">
                {currentAdminInitials}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-white">{currentAdminName}</p>
                <p className="text-[10px] capitalize text-[#C9A227]">
                  {currentAdminUser?.role ?? 'Set VITE_ADMIN_USER_ID'}
                </p>
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div className="shrink-0 border-b border-[#C9A227]/40 bg-black px-6 py-3 text-center text-sm text-[#C9A227]">
            {error}
          </div>
        )}

        <main className="flex min-h-0 flex-1">
          {activeNav === 'inbox' && (
            <InboxView
              conversations={filteredConversations}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              replyText={replyText}
              setReplyText={setReplyText}
              handleSendMessage={handleSendMessage}
              sendError={sendError}
              messagesLoading={messagesLoading}
              onEscalate={handleEscalate}
              adminUsers={adminUsers}
              onAssignConversation={handleAssignConversation}
              onStartManualMode={handleStartManualMode}
              onResumeAutomation={handleResumeAutomation}
              escalateBusy={escalateBusy}
              actionBusyId={actionBusyId}
            />
          )}

          {activeNav === 'reservations' && (
            <ReservationsView conversations={filteredConversations} />
          )}

          {activeNav === 'escalations' && (
            <EscalationsView
              tickets={escalationTickets}
              loading={escalationsLoading}
              error={escalationsError}
              onTakeOver={handleTakeOver}
              onResolve={handleResolve}
              onViewConversation={handleViewConversation}
              actionBusyId={actionBusyId}
            />
          )}

          {activeNav === 'analytics' && (
            <AnalyticsView
              conversations={conversations}
              escalations={escalationTickets}
            />
          )}
          {activeNav === 'settings' && (
            <SettingsView
              aiAutoReply={aiAutoReply}
              setAiAutoReply={setAiAutoReply}
              autoSendClarifications={autoSendClarifications}
              setAutoSendClarifications={setAutoSendClarifications}
              onSave={handleSaveSettings}
              saveMessage={saveMessage}
              settingsLoading={settingsLoading}
              settingsSaving={settingsSaving}
              settingsError={settingsError}
              emergencyDisabled={emergencyDisabled}
            />
          )}
        </main>
      </div>
    </div>
  );
}
