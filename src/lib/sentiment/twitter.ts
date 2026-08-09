// ─── RapidAPI Twitter v2 client ───────────────────────────────────────────────
// API key: localStorage 'wr-apikey-twitter-rapid'
// KOL threshold: 20,000+ followers (auto) OR in manual KOL list

import type { TwitterData, KOLMention } from '../sentiment/types';

const RAPIDAPI_HOST = 'twitter241.p.rapidapi.com';
const KOL_FOLLOWER_THRESHOLD = 20_000;
const POSITIVE_WORDS = new Set(['bullish', 'bull', 'moon', 'mooning', 'ape', 'gem', 'buy', 'long', 'pump', 'alpha', 'wagmi']);
const NEGATIVE_WORDS = new Set(['dump', 'dumping', 'rug', 'rugpull', 'scam', 'sell', 'short', 'bear', 'bearish', 'ngmi', 'rekt']);

function loadApiKey(name: string): string {
  if (typeof window === 'undefined') throw new Error(`API key '${name}' unavailable outside browser context`);
  const key = localStorage.getItem(`wr-apikey-${name}`);
  if (!key?.trim()) throw new Error(`API key '${name}' is not configured. Add it in Settings.`);
  return key.trim();
}

function parseHandle(twitterUrl: string): string {
  const stripped = twitterUrl.trim().replace(/\/$/, '');
  const fromUrl = stripped.match(/(?:twitter\.com|x\.com)\/@?([A-Za-z0-9_]{1,50})/);
  if (fromUrl) return fromUrl[1].toLowerCase();
  const bare = stripped.replace(/^@/, '');
  if (/^[A-Za-z0-9_]{1,50}$/.test(bare)) return bare.toLowerCase();
  throw new Error(`Cannot parse Twitter handle from: ${twitterUrl}`);
}

function classifySentiment(text: string): 'positive' | 'negative' | 'neutral' {
  let pos = 0; let neg = 0;
  for (const w of text.toLowerCase().split(/\W+/)) {
    if (POSITIVE_WORDS.has(w)) pos++;
    if (NEGATIVE_WORDS.has(w)) neg++;
  }
  return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
}

interface RawTweet {
  tweet_id?: string; id_str?: string; full_text?: string; text?: string;
  created_at?: string; favorite_count?: number; retweet_count?: number;
  user?: { screen_name?: string; name?: string; followers_count?: number };
}

function extractTweets(raw: unknown): RawTweet[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r['tweets'])) return r['tweets'] as RawTweet[];
  // Walk the timeline instructions tree
  const instructions = (
    (r['result'] as Record<string, unknown> | undefined)
    ?.['timeline'] as Record<string, unknown> | undefined
  )?.['instructions'];
  if (!Array.isArray(instructions)) return [];
  const tweets: RawTweet[] = [];
  for (const inst of instructions) {
    for (const entry of ((inst as Record<string, unknown>)['entries'] as unknown[] | undefined) ?? []) {
      const itemContent = ((entry as Record<string, unknown>)['content'] as Record<string, unknown> | undefined)?.['itemContent'] as Record<string, unknown> | undefined;
      const tweetResult = (itemContent?.['tweet_results'] as Record<string, unknown> | undefined)?.['result'] as Record<string, unknown> | undefined;
      const legacy = tweetResult?.['legacy'] as RawTweet | undefined;
      const userLeg = ((tweetResult?.['core'] as Record<string, unknown> | undefined)?.['user_results'] as Record<string, unknown> | undefined)?.['result'] as Record<string, unknown> | undefined;
      if (legacy) tweets.push({ ...legacy, user: userLeg?.['legacy'] as RawTweet['user'] });
    }
  }
  return tweets;
}

export async function fetchTwitterData(
  _contractOrHandle: string,
  twitterUrl: string,
  kolHandles: string[],
  _days: number,
): Promise<TwitterData> {
  const apiKey = loadApiKey('twitter-rapid');
  const handle = parseHandle(twitterUrl);
  const kolSet = new Set(kolHandles.map(h => h.toLowerCase().replace(/^@/, '')));
  const now = Date.now();
  const oneHourMs = 60 * 60 * 1000;

  const response = await fetch(
    `https://${RAPIDAPI_HOST}/search-v2?query=%40${encodeURIComponent(handle)}&count=100`,
    { headers: { 'x-rapidapi-key': apiKey, 'x-rapidapi-host': RAPIDAPI_HOST } },
  );
  if (!response.ok) throw new Error(`Twitter API error ${response.status}: ${response.statusText}`);

  const tweets = extractTweets(await response.json());
  if (tweets.length === 0) {
    return { mentionCount: 0, mentionVelocity: 1.0, sentimentBreakdown: { positive: 0, negative: 0, neutral: 100 }, kolMentions: [], fetchedAt: new Date().toISOString() };
  }

  let last1h = 0; let prev1h = 0;
  let positive = 0; let negative = 0; let neutral = 0;
  const kolMentions: KOLMention[] = [];

  for (const t of tweets) {
    const text = t.full_text ?? t.text ?? '';
    const age = now - (t.created_at ? new Date(t.created_at).getTime() : now);
    if (age <= oneHourMs) last1h++;
    else if (age <= 2 * oneHourMs) prev1h++;

    const s = classifySentiment(text);
    if (s === 'positive') positive++;
    else if (s === 'negative') negative++;
    else neutral++;

    const u = t.user;
    const screenName = (u?.screen_name ?? '').toLowerCase();
    const followerCount = u?.followers_count ?? 0;
    if (u && (followerCount >= KOL_FOLLOWER_THRESHOLD || kolSet.has(screenName))) {
      kolMentions.push({
        handle: screenName,
        displayName: u.name ?? screenName,
        followerCount,
        tweetText: text.slice(0, 120),
        tweetUrl: `https://twitter.com/${screenName}/status/${t.tweet_id ?? t.id_str ?? ''}`,
        likes: t.favorite_count ?? 0,
        retweets: t.retweet_count ?? 0,
        postedAt: t.created_at ?? new Date().toISOString(),
        isManualList: kolSet.has(screenName),
      });
    }
  }

  const total = tweets.length;
  return {
    mentionCount: total,
    mentionVelocity: Math.round((prev1h === 0 ? 1.0 : last1h / prev1h) * 100) / 100,
    sentimentBreakdown: {
      positive: Math.round((positive / total) * 100),
      negative: Math.round((negative / total) * 100),
      neutral: Math.round((neutral / total) * 100),
    },
    kolMentions,
    fetchedAt: new Date().toISOString(),
  };
}
