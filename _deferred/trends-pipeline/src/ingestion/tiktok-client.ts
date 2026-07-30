import axios, { type AxiosInstance } from "axios";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";
import { ScrapeCreatorsError } from "@/shared/errors";
import type { RawTikTokVideo } from "@/shared/types";

const log = createLogger("tiktok-client");

const BASE_URL = "https://api.scrapecreators.com";

let instance: TikTokClient | null = null;

export class TikTokClient {
  private readonly http: AxiosInstance;

  private constructor() {
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: { "x-api-key": env.SCRAPECREATORS_API_KEY ?? "" },
      timeout: 15_000,
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status ?? 0;
        const message = err.response?.data?.message ?? err.message;
        throw new ScrapeCreatorsError(status, message);
      },
    );
  }

  static getInstance(): TikTokClient {
    if (!instance) instance = new TikTokClient();
    return instance;
  }

  async searchByHashtag(hashtag: string, maxVideos = 30): Promise<RawTikTokVideo[]> {
    log.debug({ hashtag, maxVideos }, "searchByHashtag");
    const res = await this.http.get<{ data: RawScrapeVideo[] }>("/v1/tiktok/hashtag/videos", {
      params: { hashtag: hashtag.replace(/^#/, ""), count: maxVideos },
    });
    return (res.data.data ?? []).map(normalizeVideo);
  }

  async searchByKeyword(keyword: string, maxVideos = 30): Promise<RawTikTokVideo[]> {
    log.debug({ keyword, maxVideos }, "searchByKeyword");
    const res = await this.http.get<{ data: RawScrapeVideo[] }>("/v1/tiktok/search/videos", {
      params: { query: keyword, count: maxVideos },
    });
    return (res.data.data ?? []).map(normalizeVideo);
  }

  async getVideoTranscript(videoId: string): Promise<string | null> {
    log.debug({ videoId }, "getVideoTranscript");
    try {
      const res = await this.http.get<{ transcript: string }>("/v1/tiktok/video/transcript", {
        params: { videoId },
      });
      return res.data.transcript ?? null;
    } catch {
      return null;
    }
  }

  async getUserVideos(handle: string, maxVideos = 20): Promise<RawTikTokVideo[]> {
    log.debug({ handle, maxVideos }, "getUserVideos");
    const res = await this.http.get<{ data: RawScrapeVideo[] }>("/v1/tiktok/user/videos", {
      params: { username: handle.replace(/^@/, ""), count: maxVideos },
    });
    return (res.data.data ?? []).map(normalizeVideo);
  }
}

interface RawScrapeVideo {
  id: string;
  author?: { uniqueId?: string };
  stats?: { playCount?: number; diggCount?: number; shareCount?: number };
  challenges?: Array<{ title?: string }>;
  desc?: string;
  transcript?: string;
  createTime?: number;
}

function normalizeVideo(v: RawScrapeVideo): RawTikTokVideo {
  return {
    id: v.id,
    author: v.author?.uniqueId ?? "",
    views: v.stats?.playCount ?? 0,
    likes: v.stats?.diggCount ?? 0,
    shares: v.stats?.shareCount ?? 0,
    hashtags: (v.challenges ?? []).map((c) => `#${c.title ?? ""}`).filter(Boolean),
    caption: v.desc ?? "",
    transcript: v.transcript ?? null,
    createdAt: v.createTime ? new Date(v.createTime * 1000).toISOString() : new Date().toISOString(),
  };
}

export const tiktokClient = TikTokClient.getInstance();
