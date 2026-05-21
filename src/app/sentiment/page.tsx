'use client';

export const dynamic = 'force-static';

import { useState, useEffect } from 'react';
import { useSentimentStore } from '@/store/sentimentStore';
import TokenCard from '@/components/sentiment/TokenCard';
import NFTCard from '@/components/sentiment/NFTCard';
import { AddTokenForm } from '@/components/sentiment/AddTokenForm';
import { AddNFTForm } from '@/components/sentiment/AddNFTForm';
import ProGate from '@/components/ProGate';

// ─── Sentiment Page ───────────────────────────────────────────────────────────

export default function SentimentPage() {
  const {
    watchlist,
    scores,
    history,
    loading,
    alerts,
    hydrate,
    selectItem,
  } = useSentimentStore();

  const [showAddToken, setShowAddToken] = useState(false);
  const [showAddNFT,   setShowAddNFT]   = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const unseenAlerts = alerts.filter(a => !a.seen).length;

  const tokens = watchlist.filter(w => w.type === 'token');
  const nfts   = watchlist.filter(w => w.type === 'nft');

  const handleCardClick = (id: string) => {
    selectItem(id);
    // TODO: Open detail panel component (not yet implemented)
  };

  const handleItemAdded = () => {
    // Re-hydrate to pick up new item from localStorage
    hydrate();
  };

  return (
    <ProGate feature="Sentiment">
      <div style={{
        minHeight: '100vh',
        backgroundColor: 'var(--wr-bg)',
        padding: '32px 48px',
      }}>

        {/* ── Page Header ─────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '28px',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h1 style={{
                fontFamily: 'var(--font-inter)',
                fontSize: '24px',
                fontWeight: 600,
                color: 'var(--wr-text)',
                margin: 0,
                lineHeight: 1,
              }}>
                Sentiment
              </h1>

              {unseenAlerts > 0 && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'var(--wr-accent)',
                  color: '#000000',
                  fontSize: '9px',
                  fontWeight: 700,
                  borderRadius: '8px',
                  padding: '2px 7px',
                  fontFamily: 'var(--font-jetbrains)',
                  letterSpacing: '0.3px',
                }}>
                  {unseenAlerts}
                </span>
              )}
            </div>

            <p style={{
              fontFamily: 'var(--font-jetbrains)',
              fontSize: '11px',
              color: 'var(--wr-text-3)',
              margin: 0,
            }}>
              Token &amp; NFT sentiment analysis — score 0–100
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowAddToken(true)}
              style={{
                fontFamily: 'var(--font-jetbrains)',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--wr-text-2)',
                backgroundColor: 'transparent',
                border: '1px solid var(--wr-border)',
                padding: '8px 16px',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
                letterSpacing: '0.3px',
              }}
            >
              + Add Token
            </button>
            <button
              onClick={() => setShowAddNFT(true)}
              style={{
                fontFamily: 'var(--font-jetbrains)',
                fontSize: '11px',
                fontWeight: 700,
                color: '#000000',
                backgroundColor: 'var(--wr-accent)',
                border: 'none',
                padding: '8px 16px',
                cursor: 'pointer',
                letterSpacing: '0.3px',
              }}
            >
              + Add NFT
            </button>
          </div>
        </div>

        {/* ── Section divider ─────────────────────────────────────────────────── */}
        <div style={{ borderBottom: '1px solid var(--wr-border)', marginBottom: '28px' }} />

        {/* ── Watchlist Grid or Empty State ───────────────────────────────────── */}
        {watchlist.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '320px',
            gap: '16px',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '1px solid var(--wr-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--wr-text-3)',
              fontSize: '18px',
            }}>
              ◎
            </div>
            <p style={{
              fontFamily: 'var(--font-jetbrains)',
              fontSize: '13px',
              color: 'var(--wr-text-3)',
              margin: 0,
              textAlign: 'center',
            }}>
              No items in watchlist yet
            </p>
            <p style={{
              fontFamily: 'var(--font-jetbrains)',
              fontSize: '11px',
              color: 'var(--wr-text-4)',
              margin: 0,
              textAlign: 'center',
            }}>
              Add a token or NFT collection to get started
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                onClick={() => setShowAddToken(true)}
                style={{
                  fontFamily: 'var(--font-jetbrains)',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--wr-text-2)',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--wr-border)',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  letterSpacing: '0.3px',
                }}
              >
                + Add Token
              </button>
              <button
                onClick={() => setShowAddNFT(true)}
                style={{
                  fontFamily: 'var(--font-jetbrains)',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#000000',
                  backgroundColor: 'var(--wr-accent)',
                  border: 'none',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  letterSpacing: '0.3px',
                }}
              >
                + Add NFT
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Tokens section */}
            {tokens.length > 0 && (
              <div style={{ marginBottom: '32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <span style={{
                    fontFamily: 'var(--font-jetbrains)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    color: 'var(--wr-text-3)',
                  }}>
                    Tokens
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-jetbrains)',
                    fontSize: '10px',
                    fontWeight: 700,
                    color: 'var(--wr-text-4)',
                  }}>
                    {tokens.length}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, max-content))',
                  gap: '12px',
                }}>
                  {tokens.map(item => (
                    <TokenCard
                      key={item.id}
                      item={item}
                      score={scores[item.id]}
                      history={history[item.id]?.entries}
                      loading={loading[item.id]}
                      onClick={() => handleCardClick(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* NFTs section */}
            {nfts.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                  <span style={{
                    fontFamily: 'var(--font-jetbrains)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    color: 'var(--wr-text-3)',
                  }}>
                    NFT Collections
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-jetbrains)',
                    fontSize: '10px',
                    fontWeight: 700,
                    color: 'var(--wr-text-4)',
                  }}>
                    {nfts.length}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, max-content))',
                  gap: '12px',
                }}>
                  {nfts.map(item => (
                    <NFTCard
                      key={item.id}
                      item={item}
                      score={scores[item.id]}
                      history={history[item.id]?.entries}
                      loading={loading[item.id]}
                      onClick={() => handleCardClick(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Modals ──────────────────────────────────────────────────────────── */}
        {showAddToken && (
          <AddTokenForm
            onClose={() => setShowAddToken(false)}
            onAdded={handleItemAdded}
          />
        )}
        {showAddNFT && (
          <AddNFTForm
            onClose={() => setShowAddNFT(false)}
            onAdded={handleItemAdded}
          />
        )}
      </div>
    </ProGate>
  );
}
