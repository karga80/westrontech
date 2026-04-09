'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Tag, TASK_STATUS_VARIANT } from '@/components/Tag';
import ProGate from '@/components/ProGate';

// ─── AI Omni — Westron AI Assistant — matches 5iYF1 / d5JhJ / 4r232 ─────────

const SUGGESTED_PROMPTS = [
  'Set a bi-hourly transfer of 0.5 ETH when it drops below $4,050',
  'Transfer 0.1 During The Dip while Monkey at 5am',
  'Alert me if gas price goes under 15 gwei in the next 2 hours',
  'Create a DCA allocation for BAYC #180 #852 weekly for 5 months',
];

const ACTIVE_TASKS = [
  { title: 'Recurring Transfer 2 ETH', status: 'Scheduled', sub: 'Name: Layton',          actions: ['Cancel'] },
  { title: 'Last Bored Ape #5281',     status: 'Running',   sub: 'Status: HOLD / 15, TV', actions: ['Cancel', 'Pause'] },
  { title: 'Transfer Azuki #1300',     status: 'Paused',    sub: 'Action: —',             actions: ['Cancel', 'Trigger'] },
];

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

const DEMO_CARD: TaskCard = {
  type: 'Recurring Transfer',
  from: 'Main Wallet (0x1e...APQ)',
  to: 'DeFi Wallet 0x7562…F336',
  amount: '2 ETH',
  schedule: 'Every Friday at 8:00 PM',
  duration: '1 transfer (until Apr 15, 2026)',
  gasEst: '~0.014 ETH / txn',
};

const DEMO_PROMPT = 'I want to automatically transfer 2 ETH from my Main Wallet to DeFi Wallet every Friday at 8pm for the next month';

type PageState = 'idle' | 'chatting';

export default function OmniPage() {
  const [pageState, setPageState] = useState<PageState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [confirmedTaskId, setConfirmedTaskId] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { role: 'user', content: text };
    const aiMsg: Message = {
      role: 'assistant',
      content: "I can set that up for you! Here are the details I understood:",
      card: DEMO_CARD,
      state: 'confirming',
    };
    setMessages([userMsg, aiMsg]);
    setPageState('chatting');
    setInput('');
  };

  const confirmTask = () => {
    setMessages(prev => prev.map((m, i) =>
      i === prev.length - 1 ? { ...m, state: 'confirmed' } : m
    ));
    setConfirmedTaskId(0); // marks first active task as "confirmed running"
  };

  return (
    <ProGate feature="AI Automation (Omni)">
    <div
      className="flex bg-[#000000] text-white"
      style={{ height: 'calc(100vh - 56px)' }}
    >

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Messages / Initial state */}
        <div className="flex-1 overflow-y-auto px-12 py-8">

          {pageState === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full gap-8 pb-16">

              {/* Icon + heading */}
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-12 h-12 border border-[#beff00]/40 bg-[#0a1200] flex items-center justify-center">
                  <span className="text-[#beff00] text-xl font-bold">✦</span>
                </div>
                <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '24px', fontWeight: 700, color: 'var(--wr-text)' }}>Westron AI Assistant</h1>
                <p className="text-[#6e6e6e] text-[12px] max-w-[400px] leading-relaxed">
                  Create and manage time-sensitive blockchain tasks using natural language.
                </p>
              </div>

              {/* Suggested prompts */}
              <div className="w-full max-w-[640px]">
                <p className="text-[#6e6e6e] text-[9px] uppercase tracking-widest mb-3">Suggested Prompts</p>
                <div className="grid grid-cols-2 gap-2">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      onClick={() => sendMessage(p)}
                      className="text-left p-3 bg-[#111111] text-[11px] text-[#a1a1aa] hover:text-white hover:bg-[#1a1a1a] transition-colors leading-relaxed"
                      style={{ border: '1px solid var(--wr-border)', borderLeft: '2px solid var(--wr-accent)', borderRadius: '8px' }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          )}

          {pageState === 'chatting' && (
            <div className="flex flex-col gap-6 max-w-[640px]">
              {messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === 'user' && (
                    <div className="flex justify-end">
                      <div className="max-w-[480px]">
                        <p className="text-[#6e6e6e] text-[9px] text-right mb-1">7:09 PM</p>
                        <div className="bg-[#111111] border border-[#1a1a1a] px-4 py-3 text-[13px] text-white leading-relaxed">
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.state === 'confirming' && (
                    <div className="flex gap-3">
                      <div className="w-6 h-6 bg-[#0a1200] border border-[#beff00]/30 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[#beff00] text-[10px]">✦</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-[13px] text-white mb-3">{msg.content}</p>

                        {/* Task card */}
                        {msg.card && (
                          <div className="bg-[#111111] border border-[#1a1a1a] p-4 mb-3">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-4">
                              {[
                                ['Type',     msg.card.type],
                                ['From',     msg.card.from],
                                ['To',       msg.card.to],
                                ['Amount',   msg.card.amount],
                                ['Schedule', msg.card.schedule],
                                ['Duration', msg.card.duration],
                                ['Gas Est.', msg.card.gasEst],
                              ].map(([label, value]) => (
                                <div key={label} className="flex gap-2">
                                  <span className="text-[#6e6e6e] text-[11px] w-16 shrink-0">{label}</span>
                                  <span className="text-[11px] text-[#a1a1aa]">{value}</span>
                                </div>
                              ))}
                            </div>
                            <p className="text-[#6e6e6e] text-[11px] mb-3">
                              Would you like to confirm this task? You can modify any details before confirming.
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={confirmTask}
                                className="bg-[#beff00] text-black text-[12px] font-bold px-4 py-2 hover:opacity-90 transition-opacity"
                              >
                                Confirm Task
                              </button>
                              <button className="bg-[#1a1a1a] text-[#a1a1aa] text-[12px] px-4 py-2 hover:bg-[#222222] transition-colors">
                                Modify Details
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.state === 'confirmed' && (
                    <div className="flex gap-3">
                      <div className="w-6 h-6 bg-[#0a1200] border border-[#beff00]/30 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[#beff00] text-[10px]">✦</span>
                      </div>
                      <div className="flex-1">
                        {/* Success banner */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[#34d399] text-[13px] font-semibold">✓ Task created successfully!</span>
                        </div>
                        <p className="text-[#6e6e6e] text-[12px] mb-3">
                          Your recurring transfer has been scheduled. Here&apos;s a summary of the task:
                        </p>

                        {/* Green summary card */}
                        {msg.card && (
                          <div className="bg-[#0a1200] border border-[#34d399]/30 p-4 mb-3">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-[#34d399] text-[12px] font-semibold flex items-center gap-1.5">
                                <span>↺</span> {msg.card.type}
                              </span>
                              <span className="text-[10px] font-bold text-[#34d399] bg-[#34d399]/10 border border-[#34d399]/30 px-2 py-0.5">
                                ✓ Scheduled
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                              {[
                                ['From',     msg.card.from],
                                ['To',       msg.card.to],
                                ['Amount',   msg.card.amount],
                                ['Schedule', msg.card.schedule],
                                ['Duration', msg.card.duration],
                                ['Gas Est.', msg.card.gasEst],
                              ].map(([label, value]) => (
                                <div key={label} className="flex gap-2">
                                  <span className="text-[#6e6e6e] text-[11px] w-16 shrink-0">{label}</span>
                                  <span className="text-[11px] text-[#a1a1aa]">{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2 mb-3">
                          <Link
                            href="/tasks"
                            className="bg-[#beff00] text-black text-[12px] font-bold px-4 py-2 hover:opacity-90 transition-opacity"
                          >
                            View in Tasks
                          </Link>
                          <button className="bg-[#1a1a1a] text-[#a1a1aa] text-[12px] px-4 py-2 hover:bg-[#222222] transition-colors">
                            Edit Task
                          </button>
                          <button className="bg-[#1a1a1a] text-[#f87171] text-[12px] px-4 py-2 hover:bg-[#222222] transition-colors">
                            Cancel Task
                          </button>
                        </div>

                        <p className="text-[#6e6e6e] text-[11px] leading-relaxed">
                          The task is now active and will execute automatically. You can manage it from the Tasks page at any time to modify it or cancel.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-[#1a1a1a] px-12 py-4">
          <div className="flex items-center gap-3 max-w-[640px]">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
              placeholder={pageState === 'idle' ? 'Describe a task...' : 'Create another task or talk me anything...'}
              className="flex-1 bg-[#111111] border border-[#1a1a1a] px-4 py-2.5 text-[13px] text-white placeholder-[#6e6e6e] focus:outline-none focus:border-[#beff00]/50 transition-colors"
              style={{ borderRadius: '12px' }}
            />
            <button
              onClick={() => sendMessage(input)}
              className="w-9 h-9 bg-[#beff00] flex items-center justify-center hover:opacity-90 transition-opacity shrink-0 rounded-full"
            >
              <span className="text-black text-[14px] font-bold">↑</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Right sidebar: Active Tasks ── */}
      <div className="w-[272px] border-l border-[#1a1a1a] flex flex-col shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-white">Active Tasks</span>
            <span className="text-[10px] font-bold text-black bg-[#beff00] w-4 h-4 flex items-center justify-center">
              1
            </span>
          </div>
          <button className="text-[#6e6e6e] text-[11px] hover:text-[#a1a1aa] transition-colors">↻</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {ACTIVE_TASKS.map((task, i) => {
            const isJustConfirmed = confirmedTaskId === i;
            return (
              <div key={task.title} className="px-4 py-3 border-b border-[#1a1a1a]">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-[11px] text-white font-medium leading-snug">{task.title}</span>
                  <Tag variant={TASK_STATUS_VARIANT[isJustConfirmed ? 'Running' : task.status] ?? 'neutral'} size="xs">
                    {isJustConfirmed ? 'Running' : task.status}
                  </Tag>
                </div>
                <p className="text-[#6e6e6e] text-[10px] mb-2">{task.sub}</p>
                <div className="flex gap-1.5">
                  {task.actions.map(action => (
                    <button
                      key={action}
                      className={`text-[9px] font-semibold px-2 py-1 transition-colors ${
                        action === 'Cancel'
                          ? 'bg-[#1a1a1a] text-[#f87171] hover:bg-[#2a2a2a]'
                          : 'bg-[#1a1a1a] text-[#6e6e6e] hover:bg-[#2a2a2a] hover:text-[#a1a1aa]'
                      }`}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-[#1a1a1a]">
          <Link href="/tasks" className="text-[#beff00] text-[11px] hover:opacity-80 transition-opacity">
            Open Tasks Page →
          </Link>
        </div>
      </div>

    </div>
    </ProGate>
  );
}
