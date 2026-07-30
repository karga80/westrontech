import { parseUnits, formatUnits } from 'viem';

export const TOKEN_ADDRESSES: Record<string, `0x${string}`> = {
  ETH:  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
  UNI:  '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  PEPE: '0x6982508145454Ce325dDbE47a25d4ec3d2311933',
};

export const TOKEN_DECIMALS: Record<string, number> = {
  ETH:  18, WETH: 18, USDC: 6, USDT: 6,
  WBTC: 8,  LINK: 18, UNI:  18, AAVE: 18, PEPE: 18,
};

export const UNIVERSAL_ROUTER = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD' as const;
const ROUTING_API = 'https://api.uniswap.org/v2/quote';
const CHAIN_ID = 1;

export interface SwapQuote {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  amountInRaw: bigint;
  amountOutRaw: bigint;
  gasEstimateUSD: string;
  routeString: string;
  calldata: `0x${string}`;
  value: bigint;
  routerAddress: `0x${string}`;
  priceImpact: string;
  isNativeIn: boolean;
}

export async function getSwapQuote(params: {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  recipient: string;
  slippage?: number;
}): Promise<SwapQuote> {
  const { tokenIn, tokenOut, amountIn, recipient, slippage = 0.5 } = params;

  const inAddr = TOKEN_ADDRESSES[tokenIn];
  const outAddr = TOKEN_ADDRESSES[tokenOut];
  if (!inAddr) throw new Error(`Unsupported token: ${tokenIn}`);
  if (!outAddr) throw new Error(`Unsupported token: ${tokenOut}`);

  const inDec = TOKEN_DECIMALS[tokenIn] ?? 18;
  const outDec = TOKEN_DECIMALS[tokenOut] ?? 18;
  const amountInRaw = parseUnits(amountIn, inDec);

  const body = {
    tokenInAddress: inAddr,
    tokenInChainId: CHAIN_ID,
    tokenOutAddress: outAddr,
    tokenOutChainId: CHAIN_ID,
    amount: amountInRaw.toString(),
    type: 'EXACT_INPUT',
    configs: [{
      protocols: ['V2', 'V3', 'MIXED'],
      enableUniversalRouter: true,
      recipient: recipient || '0x0000000000000000000000000000000000000001',
      slippageTolerance: slippage.toString(),
      deadline: 1800,
    }],
  };

  const res = await fetch(ROUTING_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://app.uniswap.org' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Uniswap API ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const q = data.quote ?? data;
  const mp = q.methodParameters;
  if (!mp?.calldata) throw new Error('No route found for this pair');

  const amountOutRaw = BigInt(q.quote ?? q.quoteDecimals ?? '0');
  const amountOut = formatUnits(amountOutRaw, outDec);

  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    amountInRaw,
    amountOutRaw,
    gasEstimateUSD: Number(q.gasUseEstimateUSD ?? 0).toFixed(2),
    routeString: q.routeString ?? `${tokenIn} → ${tokenOut}`,
    calldata: mp.calldata as `0x${string}`,
    value: BigInt(mp.value ?? '0x0'),
    routerAddress: (mp.to ?? UNIVERSAL_ROUTER) as `0x${string}`,
    priceImpact: q.priceImpact != null ? `${Number(q.priceImpact).toFixed(2)}%` : '<0.01%',
    isNativeIn: tokenIn === 'ETH',
  };
}
