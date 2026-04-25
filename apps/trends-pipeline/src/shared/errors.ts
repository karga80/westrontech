export class RateLimitError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly resetAt: Date,
  ) {
    super(`Rate limit hit for ${endpoint}, resets at ${resetAt.toISOString()}`);
    this.name = "RateLimitError";
  }
}

export class ScrapeCreatorsError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(`ScrapeCreators API error ${statusCode}: ${message}`);
    this.name = "ScrapeCreatorsError";
  }
}

export class ReservoirError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(`Reservoir API error ${statusCode}: ${message}`);
    this.name = "ReservoirError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
