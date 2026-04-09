'use client';

import { useState, useRef, useEffect } from 'react';
import { Tag, TASK_STATUS_VARIANT } from '@/components/Tag';
import ProGate from '@/components/ProGate';

// ─── Combined Tasks + AI Assistant — replaces both tasks/page & omni/page ─────

type TaskStatus = 'Pending' | 'Processing' | 'Scheduled' | 'Finished' | 'Failed';
type FilterTab  = 'Pending' | 'Scheduled' | 'Finished';

interface Task {
  id: string;
  iconChar: string;
  iconBg: string;
  label: string;
  meta: string;
  status: TaskStatus;
  tab: FilterTab;
  aiGenerated?: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  card?: TaskCard;
  state?: 'confirming' | 'confirmed';
}

interface TaskCard {
  type: string;
  from: string;
  to: string;
  amount: string;
  schedule: string;
  duration: string;
  gasEst: string;
}


const ICON_MAP: Record<string, { char: string; bg: string }> = {
  Transfer: { char: '⇄', bg: '#A855F7' },
  List:     { char: '↑', bg: '#BEFF00' },
  Bid:      { char: '◎', bg: '#60a5fa' },
  Sweep:    { char: '≡', bg: '#888'    },
  Other:    { char: '✦', bg: '#BEFF00' },
};

const SUGGESTED_PROMPTS = [
  'Set a bi-hourly transfer of 0.5 ETH when it drops below $4,050',
  'Transfer 0.1 ETH during the dip at 5am',
  'Alert me if gas price goes under 15 gwei in the next 2 hours',
  'Create a DCA for BAYC #180 weekly for 5 months',
];

const DEMO_CARD: TaskCard = {
  type:     'Recurring Transfer',
  from:     'Main Wallet (0x1e...APQ)',
  to:       'DeFi Wallet 0x7562…F336',
  amount:   '2 ETH',
  schedule: 'Every Friday at 8:00 PM',
  duration: '1 transfer (until Apr 15, 2026)',
  gasEst:   '~0.014 ETH / txn',
};

const INITIAL_TASKS: Task[] = [
  { id: '1', iconChar: '↑', iconBg: '#BEFF00', label: 'List Bored Ape #3291 on OpenSea',    meta: 'Price: 12.5 ETH · Expires: 7d · Main Wallet', status: 'Pending',   tab: 'Pending'   },
  { id: '2', iconChar: '↑', iconBg: '#60a5fa', label: 'Bid on CryptoPunk #5822',             meta: 'Bid: 80 ETH · Expires: 24h · Blur Wallet',   status: 'Pending',   tab: 'Pending'   },
  { id: '3', iconChar: '⇄', iconBg: '#A855F7', label: 'Transfer Azuki #1108 to Cold Wallet', meta: 'To: Polygon Cold · Now',                      status: 'Processing',tab: 'Pending',  aiGenerated: true },
  { id: '4', iconChar: '≡', iconBg: '#888',    label: 'Bulk List Doodles (12 items)',         meta: 'Floor price · 09 Jan 2025, 14:00',            status: 'Scheduled', tab: 'Scheduled', aiGenerated: true },
  { id: '5', iconChar: '✓', iconBg: '#34D399', label: 'Sweep Azuki Floor (3 NFTs)',           meta: 'Completed · 0.4 ETH gas · 23 Dec',            status: 'Finished',  tab: 'Finished'  },
];

let nextId = 10;

// ─── New Task Modal ────────────────────────────────────────────────────────────
function NewTaskModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (task: Task) => void;
}) {
  const [type,    setType]    = useState('Transfer');
  const [label,   setLabel]   = useState('');
  const [meta,    setMeta]    = useState('');
  const [sched,   setSched]   = useState('');
  const [tab,     setTab]     = useState<FilterTab>('Pending');

  const submit = () => {
    if (!label.trim()) return;
    const ic = ICON_MAP[type] ?? ICON_MAP.Other;
    onAdd({
      id: String(++nextId),
      iconChar: ic.char,
      iconBg:   ic.bg,
      label:    label.trim(),
      meta:     [meta.trim(), sched.trim()].filter(Boolean).join(' · ') || type,
      status:   tab === 'Scheduled' ? 'Scheduled' : 'Pending',
      tab,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="flex flex-col h-full"
        style={{ width: '420px', backgroundColor: 'var(--wr-surface-alt)', borderLeft: '1px solid var(--wr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--wr-border)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[var(--wr-surface)] border border-[var(--wr-border-hover)] flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4h9M2 6.5h9M2 9h5" stroke="#6E6E6E" strokeWidth="1.1" strokeLinecap="round"/></svg>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>New Task</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)' }}>Create a task manually</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6e6e6e] hover:text-white transition-colors text-[16px]">✕</button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            {/* Type */}
            <div>
              <label className="block text-[10px] text-[#6e6e6e] uppercase tracking-wider mb-1.5">Type</label>
              <div className="flex gap-2 flex-wrap">
                {['Transfer', 'List', 'Bid', 'Sweep', 'Other'].map(t => (
                  <button key={t} onClick={() => setType(t)}
                    className="text-[11px] px-3 py-1.5 transition-colors"
                    style={{
                      fontFamily: 'var(--font-jetbrains)',
                      backgroundColor: type === t ? '#BEFF00' : 'var(--wr-overlay)',
                      color:           type === t ? '#000000' : '#a1a1aa',
                      border:          type === t ? 'none'    : '1px solid var(--wr-border-hover)',
                    }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Label */}
            <div>
              <label className="block text-[10px] text-[#6e6e6e] uppercase tracking-wider mb-1.5">Description</label>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. List BAYC #3291 on OpenSea"
                className="w-full bg-[var(--wr-surface)] border border-[var(--wr-border)] px-3 py-2 text-[12px] text-white placeholder-[#555] focus:outline-none focus:border-[#beff00]/50"
                style={{ fontFamily: 'var(--font-jetbrains)', borderRadius: '6px' }}
              />
            </div>

            {/* Meta */}
            <div>
              <label className="block text-[10px] text-[#6e6e6e] uppercase tracking-wider mb-1.5">Details <span className="normal-case text-[var(--wr-text-3)]">(price, wallet, etc.)</span></label>
              <input
                value={meta}
                onChange={e => setMeta(e.target.value)}
                placeholder="e.g. Price: 12.5 ETH · Main Wallet"
                className="w-full bg-[var(--wr-surface)] border border-[var(--wr-border)] px-3 py-2 text-[12px] text-white placeholder-[#555] focus:outline-none focus:border-[#beff00]/50"
                style={{ fontFamily: 'var(--font-jetbrains)', borderRadius: '6px' }}
              />
            </div>

            {/* Schedule */}
            <div>
              <label className="block text-[10px] text-[#6e6e6e] uppercase tracking-wider mb-1.5">Schedule <span className="normal-case text-[var(--wr-text-3)]">(optional)</span></label>
              <input
                value={sched}
                onChange={e => { setSched(e.target.value); if (e.target.value) setTab('Scheduled'); else setTab('Pending'); }}
                placeholder="e.g. 09 Jan 2025, 14:00"
                className="w-full bg-[var(--wr-surface)] border border-[var(--wr-border)] px-3 py-2 text-[12px] text-white placeholder-[#555] focus:outline-none focus:border-[#beff00]/50"
                style={{ fontFamily: 'var(--font-jetbrains)', borderRadius: '6px' }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--wr-border)] px-5 py-4 shrink-0">
          <div className="flex gap-3">
            <button
              onClick={submit}
              disabled={!label.trim()}
              className="flex-1 text-[12px] font-bold py-2.5 transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#BEFF00', color: '#000', fontFamily: 'var(--font-jetbrains)', borderRadius: '6px' }}
            >
              Create Task
            </button>
            <button onClick={onClose}
              className="px-5 text-[12px] text-[#a1a1aa] hover:text-white transition-colors"
              style={{ backgroundColor: 'var(--wr-border)', border: '1px solid var(--wr-border-hover)', fontFamily: 'var(--font-jetbrains)', borderRadius: '6px' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AI Chat Panel ─────────────────────────────────────────────────────────────
function AiPanel({ onClose, onTaskConfirmed }: {
  onClose: () => void;
  onTaskConfirmed: (task: Task) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState('');
  const [chatting, setChatting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = (text: string) => {
    if (!text.trim()) return;
    setMessages([
      { role: 'user', content: text },
      { role: 'assistant', content: 'I can set that up for you! Here are the details I understood:', card: DEMO_CARD, state: 'confirming' },
    ]);
    setChatting(true);
    setInput('');
  };

  const confirm = () => {
    setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, state: 'confirmed' } : m));
    onTaskConfirmed({
      id:           String(++nextId),
      iconChar:     '⇄',
      iconBg:       '#A855F7',
      label:        `${DEMO_CARD.type} — ${DEMO_CARD.amount}`,
      meta:         `${DEMO_CARD.schedule} · ${DEMO_CARD.from.split(' ')[0]}`,
      status:       'Scheduled',
      tab:          'Scheduled',
      aiGenerated:  true,
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div
        className="flex flex-col h-full"
        style={{ width: '420px', backgroundColor: 'var(--wr-surface-alt)', borderLeft: '1px solid var(--wr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--wr-border)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[var(--wr-accent-dim)] border border-[#beff00]/40 flex items-center justify-center">
              <span className="text-[#beff00] text-[12px]">✦</span>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>Westron AI</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)' }}>Create tasks with natural language</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6e6e6e] hover:text-white transition-colors text-[16px]">✕</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {!chatting && (
            <div className="flex flex-col gap-4">
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                Describe a task in plain language — scheduling, transfers, listings, bids and more.
              </p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#444', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '4px' }}>Suggestions</p>
              <div className="flex flex-col gap-2">
                {SUGGESTED_PROMPTS.map(p => (
                  <button key={p} onClick={() => send(p)}
                    className="text-left text-[11px] text-[#a1a1aa] hover:text-white transition-colors leading-relaxed px-3 py-2.5 hover:bg-[#1a1a1a]"
                    style={{ border: '1px solid var(--wr-border)', borderLeft: '2px solid var(--wr-accent)', borderRadius: '6px', fontFamily: 'var(--font-jetbrains)' }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatting && (
            <div className="flex flex-col gap-5">
              {messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === 'user' && (
                    <div className="flex justify-end">
                      <div className="max-w-[300px] bg-[#111111] border border-[#1a1a1a] px-3 py-2.5 text-[12px] text-white leading-relaxed"
                        style={{ fontFamily: 'var(--font-jetbrains)', borderRadius: '8px 8px 2px 8px' }}>
                        {msg.content}
                      </div>
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.state === 'confirming' && (
                    <div className="flex gap-2.5">
                      <div className="w-5 h-5 bg-[#0a1200] border border-[#beff00]/30 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[#beff00] text-[8px]">✦</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-[12px] text-white mb-3" style={{ fontFamily: 'var(--font-jetbrains)' }}>{msg.content}</p>
                        {msg.card && (
                          <div className="bg-[#111111] border border-[#1a1a1a] p-3 mb-3" style={{ borderRadius: '8px' }}>
                            <div className="space-y-1.5 mb-3">
                              {[['Type', msg.card.type], ['From', msg.card.from], ['To', msg.card.to], ['Amount', msg.card.amount], ['Schedule', msg.card.schedule], ['Gas Est.', msg.card.gasEst]].map(([l, v]) => (
                                <div key={l} className="flex gap-2">
                                  <span className="text-[#6e6e6e] text-[10px] w-14 shrink-0" style={{ fontFamily: 'var(--font-jetbrains)' }}>{l}</span>
                                  <span className="text-[10px] text-[#a1a1aa]" style={{ fontFamily: 'var(--font-jetbrains)' }}>{v}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button onClick={confirm}
                                className="flex-1 text-[11px] font-bold py-1.5 hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: '#BEFF00', color: '#000', fontFamily: 'var(--font-jetbrains)' }}>
                                Confirm Task
                              </button>
                              <button className="px-3 text-[11px] text-[#a1a1aa] hover:bg-[#222] transition-colors"
                                style={{ backgroundColor: 'var(--wr-border)', fontFamily: 'var(--font-jetbrains)' }}>
                                Modify
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.state === 'confirmed' && (
                    <div className="flex gap-2.5">
                      <div className="w-5 h-5 bg-[#0a1200] border border-[#beff00]/30 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[#beff00] text-[8px]">✦</span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[#34d399] text-[12px] font-semibold" style={{ fontFamily: 'var(--font-jetbrains)' }}>✓ Task added to your list</span>
                        </div>
                        <p className="text-[10px] text-[#6e6e6e]" style={{ fontFamily: 'var(--font-jetbrains)' }}>
                          The task has been scheduled and tagged as AI-generated.
                        </p>
                        <button onClick={() => { setMessages([]); setChatting(false); setInput(''); }}
                          className="mt-3 text-[10px] hover:opacity-80 transition-opacity" style={{ color: 'var(--wr-accent)', fontFamily: 'var(--font-jetbrains)' }}>
                          + Create another task →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-[#1a1a1a] px-5 py-4 shrink-0">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder="Describe a task…"
              className="flex-1 bg-[#111111] border border-[#1a1a1a] px-3 py-2 text-[12px] text-white placeholder-[#555] focus:outline-none focus:border-[#beff00]/50 transition-colors"
              style={{ fontFamily: 'var(--font-jetbrains)', borderRadius: '8px' }}
            />
            <button onClick={() => send(input)}
              className="w-8 h-8 bg-[#beff00] flex items-center justify-center hover:opacity-90 transition-opacity shrink-0 rounded-full">
              <span className="text-black text-[13px] font-bold">↑</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const [tasks,       setTasks]      = useState<Task[]>(INITIAL_TASKS);
  const [activeTab,   setActiveTab]  = useState<FilterTab>('Pending');
  const [modalOpen,   setModalOpen]  = useState(false);
  const [aiOpen,      setAiOpen]     = useState(false);
  const [menuOpen,    setMenuOpen]   = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const filtered       = tasks.filter(t => t.tab === activeTab);
  const pendingCount   = tasks.filter(t => t.tab === 'Pending').length;
  const processingCount = tasks.filter(t => t.status === 'Processing').length;

  const addTask = (task: Task) => {
    setTasks(prev => [task, ...prev]);
    setActiveTab(task.tab);
  };

  const cancelTask = (id: string) => setTasks(prev => prev.filter(t => t.id !== id));

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'Pending',   label: 'Pending',   count: pendingCount },
    { key: 'Scheduled', label: 'Scheduled' },
    { key: 'Finished',  label: 'Finished'  },
  ];

  return (
    <ProGate feature="Task Automation">
    <>
      <main className="min-h-full bg-[var(--wr-surface-alt)] text-white flex flex-col">
        <div className="px-12 py-8 flex-1">

          {/* Page header */}
          <div className="flex items-center justify-between mb-5">
            <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>Tasks</h1>
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-4 py-1.5 hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#BEFF00', color: '#000', fontFamily: 'var(--font-jetbrains)' }}
              >
                + New Task
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ marginLeft: '2px' }}>
                  <path d="M1 3l3 3 3-3" stroke="#000" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {menuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  width: '200px', backgroundColor: 'var(--wr-surface)',
                  border: '1px solid var(--wr-border-hover)', zIndex: 200,
                }}>
                  <button
                    onClick={() => { setMenuOpen(false); setModalOpen(true); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#1a1a1a] transition-colors"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid #1a1a1a' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4h9M2 6.5h9M2 9h5" stroke="#6E6E6E" strokeWidth="1.1" strokeLinecap="round"/></svg>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)' }}>Manual</span>
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); setAiOpen(true); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#1a1a1a] transition-colors"
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v2M6.5 10v2M1 6.5h2M10 6.5h2M2.93 2.93l1.41 1.41M8.66 8.66l1.41 1.41M2.93 10.07l1.41-1.41M8.66 4.34l1.41-1.41" stroke="#6E6E6E" strokeWidth="1.1" strokeLinecap="round"/><circle cx="6.5" cy="6.5" r="2" stroke="#6E6E6E" strokeWidth="1.1"/></svg>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)' }}>Create with AI</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-0 border-b border-[#1A1A1A] mb-4">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  fontFamily:   'var(--font-jetbrains)',
                  fontSize:     '13px',
                  fontWeight:   500,
                  padding:      '8px 16px',
                  color:        activeTab === tab.key ? 'var(--wr-accent)' : '#6E6E6E',
                  marginBottom: '-1px',
                  background:   'none',
                  border:       'none',
                  borderBottom: activeTab === tab.key ? '2px solid var(--wr-accent)' : '2px solid transparent',
                  cursor:       'pointer',
                  transition:   'color 0.15s',
                }}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span style={{
                    fontFamily:      'var(--font-jetbrains)',
                    fontSize:        '10px',
                    fontWeight:      700,
                    padding:         '1px 6px',
                    marginLeft:      '6px',
                    borderRadius:    '8px',
                    backgroundColor: activeTab === tab.key ? '#BEFF0022' : '#1A1A1A',
                    color:           activeTab === tab.key ? 'var(--wr-accent)'   : '#6E6E6E',
                  }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Task list */}
          <div className="space-y-2">
            {filtered.map(task => {
              return (
                <div
                  key={task.id}
                  className="flex items-center justify-between px-5 hover:border-[#333] transition-colors cursor-pointer"
                  style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', borderRadius: '8px', height: '76px' }}
                >
                  {/* Left */}
                  <div className="flex items-center gap-4 min-w-0">
                    <div
                      className="w-9 h-9 flex items-center justify-center font-bold text-sm shrink-0"
                      style={{ backgroundColor: task.iconBg, color: task.iconBg === '#BEFF00' ? '#000' : '#fff', borderRadius: '8px' }}
                    >
                      {task.iconChar}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-[13px] font-semibold truncate">{task.label}</span>
                        {task.aiGenerated && (
                          <Tag variant="accent" size="xs">✦ AI</Tag>
                        )}
                      </div>
                      <div className="text-[#6e6e6e] text-[11px] mt-0.5 truncate">{task.meta}</div>
                    </div>
                  </div>

                  {/* Right */}
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <Tag variant={TASK_STATUS_VARIANT[task.status] ?? 'neutral'} dot>{task.status}</Tag>
                    <button
                      onClick={() => cancelTask(task.id)}
                      className="text-[#F87171] text-[11px] border border-[#7f1d1d] px-3 py-1 hover:bg-[#450a0a] transition-colors"
                      style={{ borderRadius: '6px', fontFamily: 'var(--font-jetbrains)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="text-center py-16">
                <div className="text-[32px] mb-3 opacity-20">◎</div>
                <p className="text-[#6e6e6e] text-[13px]">No {activeTab.toLowerCase()} tasks.</p>
                <button onClick={() => setModalOpen(true)}
                  className="mt-4 text-[11px] hover:opacity-80 transition-opacity" style={{ color: 'var(--wr-accent)', fontFamily: 'var(--font-jetbrains)' }}>
                  + Create one →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Processing bar */}
        {processingCount > 0 && (
          <div className="border-t border-[#beff00] bg-[#0a1200] px-6 py-3 flex items-center gap-2 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-[#BEFF00] animate-pulse shrink-0" />
            <span className="text-[11px] font-medium" style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--wr-accent)' }}>
              {processingCount} task{processingCount > 1 ? 's are' : ' is'} processing.
            </span>
          </div>
        )}
      </main>

      {/* Modals / Panels */}
      {modalOpen && <NewTaskModal onClose={() => setModalOpen(false)} onAdd={addTask} />}
      {aiOpen    && <AiPanel onClose={() => setAiOpen(false)} onTaskConfirmed={task => { addTask(task); }} />}
    </>
    </ProGate>
  );
}
