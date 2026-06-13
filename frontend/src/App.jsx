import { useState } from 'react';

const NAV_ITEMS = [
  { id: 'inbox', label: 'Inbox', badge: '4' },
  { id: 'reservations', label: 'Reservations', badge: null },
  { id: 'escalations', label: 'Escalations', badge: '1' },
  { id: 'analytics', label: 'Analytics', badge: null },
  { id: 'settings', label: 'Settings', badge: null },
];

const CONVERSATIONS = [
  {
    id: '1',
    guest: 'Nimal Perera',
    phone: '+94 77 234 5678',
    apartment: 'Negombo Ocean Breeze Luxury Studio',
    bookingId: 'SV-NGB-1042',
    checkIn: '12 Jun 2026',
    checkOut: '15 Jun 2026',
    status: 'Checked In',
    priority: 'normal',
    lastMessage: 'What time is checkout on Sunday?',
    time: '5m ago',
    unread: 1,
    aiInsight: 'Checkout inquiry',
    messages: [
      { id: 1, from: 'guest', text: 'Ayubowan! We just checked in. The ocean view is stunning.', time: '09:14' },
      { id: 2, from: 'system', text: 'Welcome to Negombo Ocean Breeze Luxury Studio. Check-in from 2:00 PM. Wi-Fi: OceanBreeze_Guest · Password: Negombo@2026', time: '09:15' },
      { id: 3, from: 'guest', text: 'Is airport pickup still arranged for our departure?', time: '14:22' },
      { id: 4, from: 'ai', text: 'Your airport transfer is confirmed for 15 Jun at 10:30 AM. Our driver will contact you on WhatsApp 30 minutes prior.', time: '14:22' },
      { id: 5, from: 'guest', text: 'What time is checkout on Sunday?', time: '16:48' },
    ],
    reservation: {
      guests: 2,
      nights: 3,
      source: 'Airbnb',
      total: 'LKR 84,500',
      policy: 'Checkout by 11:00 AM',
    },
  },
  {
    id: '2',
    guest: 'Emma Richardson',
    phone: '+44 7911 123456',
    apartment: 'Panadura Ayurveda Retreat',
    bookingId: 'SV-PAN-2087',
    checkIn: '14 Jun 2026',
    checkOut: '21 Jun 2026',
    status: 'Confirmed',
    priority: 'escalated',
    lastMessage: 'The hot water in the ensuite is not working.',
    time: '22m ago',
    unread: 2,
    aiInsight: 'Maintenance emergency',
    messages: [
      { id: 1, from: 'guest', text: 'Hello, we arrive tomorrow for the 7-day wellness package. Can we arrange early check-in at 11 AM?', time: '08:30' },
      { id: 2, from: 'ai', text: 'Early check-in requests require staff approval. A Serendib Vacation coordinator will review your message shortly.', time: '08:31' },
      { id: 3, from: 'guest', text: 'We are here now but the hot water in the ensuite is not working.', time: '16:10' },
      { id: 4, from: 'guest', text: 'The hot water in the ensuite is not working.', time: '16:12' },
    ],
    reservation: {
      guests: 1,
      nights: 7,
      source: 'Booking.com',
      total: 'USD 1,240',
      policy: 'Checkout by 10:00 AM',
    },
  },
  {
    id: '3',
    guest: 'Hans Müller',
    phone: '+49 170 882 3344',
    apartment: 'Global Grand Residencies Nuwara Eliya',
    bookingId: 'SV-NUW-3156',
    checkIn: '10 Jun 2026',
    checkOut: '14 Jun 2026',
    status: 'Checked In',
    priority: 'normal',
    lastMessage: 'Perfect, thank you very much!',
    time: '1h ago',
    unread: 0,
    aiInsight: 'Wi-Fi credentials request',
    messages: [
      { id: 1, from: 'guest', text: 'Guten Tag. It is quite cold up here — is extra bedding available?', time: '19:05' },
      { id: 2, from: 'system', text: 'Additional blankets are stored in the wardrobe. Housekeeping can deliver more upon request before 9 PM.', time: '19:06' },
      { id: 3, from: 'guest', text: 'Could you send the Wi-Fi details again please?', time: '20:40' },
      { id: 4, from: 'system', text: 'Network: GGR_NuwaraEliya · Password: HillCountry@2026', time: '20:40' },
      { id: 5, from: 'guest', text: 'Perfect, thank you very much!', time: '20:42' },
    ],
    reservation: {
      guests: 2,
      nights: 4,
      source: 'Direct',
      total: 'EUR 920',
      policy: 'Checkout by 11:00 AM',
    },
  },
  {
    id: '4',
    guest: 'Priya Fernando',
    phone: '+94 71 998 7766',
    apartment: 'Negombo Ocean Breeze Luxury Studio',
    bookingId: 'SV-NGB-1098',
    checkIn: '16 Jun 2026',
    checkOut: '19 Jun 2026',
    status: 'Confirmed',
    priority: 'normal',
    lastMessage: 'Is parking available near the studio?',
    time: '3h ago',
    unread: 1,
    aiInsight: 'Parking inquiry',
    messages: [
      { id: 1, from: 'guest', text: 'Hi, booking confirmed for next week. Travelling from Kandy with our own car.', time: '11:05' },
      { id: 2, from: 'guest', text: 'Is parking available near the studio?', time: '11:06' },
    ],
    reservation: {
      guests: 3,
      nights: 3,
      source: 'Airbnb',
      total: 'LKR 96,000',
      policy: 'Checkout by 11:00 AM',
    },
  },
];

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
    Resolved: 'bg-[#132B4F] text-white/70 border-[#1E3A5F]',
  };

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[status] ?? styles.Confirmed}`}>
      {status}
    </span>
  );
}

function MessageBubble({ message }) {
  const isGuest = message.from === 'guest';
  const isSystem = message.from === 'system';
  const isAi = message.from === 'ai';

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
          <span className="mt-1 block text-[10px] text-white/40">{message.time}</span>
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
          <span className="mt-1 block text-[10px] text-[#0B1F3A]/40">{message.time}</span>
        </div>
      </div>
    );
  }

  return null;
}

function InboxView({ selectedId, setSelectedId, replyText, setReplyText }) {
  const selected = CONVERSATIONS.find((c) => c.id === selectedId) ?? CONVERSATIONS[0];

  return (
    <>
      <section className="flex w-80 shrink-0 flex-col border-r border-[#1E3A5F] bg-[#0B1F3A]">
        <div className="border-b border-[#1E3A5F] px-4 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[#C9A227]">Conversations</h3>
            <span className="rounded-full bg-[#132B4F] px-2 py-0.5 text-[10px] text-white/60">
              {CONVERSATIONS.length} active
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {CONVERSATIONS.map((convo) => {
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
                          Esc
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
                .join('')}
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{selected.guest}</h3>
              <p className="text-xs text-white/50">{selected.phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={selected.status} />
            {selected.priority === 'escalated' && (
              <button
                type="button"
                className="rounded-lg border border-[#C9A227] bg-[#C9A227] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[#0B1F3A] transition hover:bg-[#D4AF37]"
              >
                Take Over
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-2xl rounded-xl border border-[#1E3A5F] bg-[#0B1F3A]/50 px-4 py-2 text-center">
            <p className="text-[10px] font-medium uppercase tracking-widest text-white/40">
              Today · {selected.apartment}
            </p>
          </div>

          {selected.messages.map((msg) => (
            <div key={msg.id} className="mx-auto max-w-2xl">
              <MessageBubble message={msg} />
            </div>
          ))}
        </div>

        <div className="border-t border-[#1E3A5F] bg-[#0B1F3A] px-6 py-4">
          <div className="mx-auto flex max-w-2xl items-end gap-3">
            <textarea
              rows={2}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type your reply to the guest..."
              className="flex-1 resize-none rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
            />
            <button
              type="button"
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
            <p className="mt-3 text-xs leading-relaxed text-white/50">
              No smoking indoors. Quiet hours after 10 PM. Ayurveda retreat guests must observe meal timings.
            </p>
          </div>

          <div className="mt-4 space-y-2">
            <button
              type="button"
              className="w-full rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-4 py-3 text-left text-sm font-medium text-white transition hover:border-[#C9A227]/50"
            >
              View Full Booking
            </button>
            <button
              type="button"
              className="w-full rounded-xl border border-[#C9A227]/40 bg-black px-4 py-3 text-left text-sm font-medium text-[#C9A227] transition hover:bg-[#C9A227] hover:text-[#0B1F3A]"
            >
              Escalate to Supervisor
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-[#1E3A5F] bg-black p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">AI Insight</p>
            <p className="mt-2 text-sm text-white/70">
              Guest intent detected:{' '}
              <span className="font-medium text-[#C9A227]">{selected.aiInsight}</span>
            </p>
            <p className="mt-2 text-xs text-white/40">
              Suggested reply ready. Rules engine could auto-resolve if policy data is complete.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

function ReservationsView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#132B4F] p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#C9A227]">Serendib Vacation</p>
          <h3 className="mt-1 text-2xl font-bold text-white">All Bookings</h3>
          <p className="mt-1 text-sm text-white/50">{CONVERSATIONS.length} reservations across 3 properties</p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1F3A] px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Checked In</p>
            <p className="text-lg font-bold text-[#C9A227]">
              {CONVERSATIONS.filter((c) => c.status === 'Checked In').length}
            </p>
          </div>
          <div className="rounded-xl border border-[#1E3A5F] bg-[#0B1F3A] px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-white/40">Confirmed</p>
            <p className="text-lg font-bold text-white">
              {CONVERSATIONS.filter((c) => c.status === 'Confirmed').length}
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#1E3A5F] bg-[#0B1F3A] shadow-2xl shadow-black/40">
        <div className="overflow-x-auto overflow-y-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-black">
              <tr className="border-b border-[#1E3A5F]">
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">
                  Guest Name
                </th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">
                  Apartment
                </th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">
                  Check-in
                </th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">
                  Check-out
                </th>
                <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">
                  Status
                </th>
                <th className="px-6 py-4 text-right text-[10px] font-bold uppercase tracking-[0.2em] text-[#C9A227]">
                  Total Price
                </th>
              </tr>
            </thead>
            <tbody>
              {CONVERSATIONS.map((booking, index) => (
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
          <p className="text-xs font-medium text-[#C9A227]">
            Negombo · Panadura · Nuwara Eliya
          </p>
        </div>
      </div>
    </div>
  );
}

function PlaceholderView({ activeNav }) {
  const labels = {
    escalations: 'Escalations queue',
    analytics: 'Analytics dashboard',
    settings: 'Settings panel',
  };

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-[#132B4F] p-8">
      <div className="max-w-md rounded-2xl border border-[#1E3A5F] bg-[#0B1F3A] p-10 text-center shadow-xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#C9A227]">Coming Soon</p>
        <h3 className="mt-3 text-xl font-bold text-white">{labels[activeNav]}</h3>
        <p className="mt-2 text-sm text-white/50">
          This section will be available in a future release of the Serendib Vacation admin dashboard.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [activeNav, setActiveNav] = useState('inbox');
  const [selectedId, setSelectedId] = useState(CONVERSATIONS[0].id);
  const [replyText, setReplyText] = useState('');

  const header = HEADER_COPY[activeNav] ?? HEADER_COPY.inbox;

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
                {item.badge && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isActive ? 'bg-[#0B1F3A]/20 text-[#0B1F3A]' : 'bg-[#C9A227] text-[#0B1F3A]'
                    }`}
                  >
                    {item.badge}
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
                <p className="text-xl font-bold text-white">3</p>
                <p className="text-[10px] text-white/50">Properties</p>
              </div>
              <div>
                <p className="text-xl font-bold text-[#C9A227]">4</p>
                <p className="text-[10px] text-white/50">Active Bookings</p>
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
                placeholder="Search guests, bookings..."
                className="w-72 rounded-xl border border-[#1E3A5F] bg-[#132B4F] py-2 pl-10 pr-4 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
              />
            </div>

            <button
              type="button"
              className="relative rounded-xl border border-[#1E3A5F] bg-[#132B4F] p-2.5 text-white/70 transition hover:border-[#C9A227]/50 hover:text-[#C9A227]"
            >
              <IconBell />
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#C9A227] text-[9px] font-bold text-[#0B1F3A]">
                1
              </span>
            </button>

            <div className="flex items-center gap-3 rounded-xl border border-[#1E3A5F] bg-[#132B4F] px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#C9A227] text-xs font-bold text-[#0B1F3A]">
                KS
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-white">Kavish Silva</p>
                <p className="text-[10px] text-[#C9A227]">Operations Manager</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex min-h-0 flex-1">
          {activeNav === 'inbox' && (
            <InboxView
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              replyText={replyText}
              setReplyText={setReplyText}
            />
          )}

          {activeNav === 'reservations' && <ReservationsView />}

          {activeNav !== 'inbox' && activeNav !== 'reservations' && (
            <PlaceholderView activeNav={activeNav} />
          )}
        </main>
      </div>
    </div>
  );
}
