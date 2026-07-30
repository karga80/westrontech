import { createPublicClient, createWalletClient, http, maxUint256 } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { TOKEN_ADDRESSES } from './uniswap';

const ERC20_ABI = [
  {
    name: 'allowance', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

export type SwapStatus =
  | 'checking-allowance'
  | 'approving'
  | 'waiting-approve'
  | 'swapping'
  | 'waiting-swap'
  | 'confirmed';

export interface SwapResult {
  swapTxHash: `0x${string}`;
  approveTxHash?: `0x${string}`;
}

export async function executeSwap(params: {
  privateKeyHex: string;
  tokenIn: string;
  calldata: `0x${string}`;
  value: bigint;
  routerAddress: `0x${string}`;
  amountInRaw: bigint;
  alchemyKey: string;
  onStatus: (s: SwapStatus) => void;
}): Promise<SwapResult> {
  const { privateKeyHex, tokenIn, calldata, value, routerAddress, amountInRaw, alchemyKey, onStatus } = params;

  const hex = privateKeyHex.startsWith('0x') ? privateKeyHex as `0x${string}` : `0x${privateKeyHex}` as `0x${string}`;
  const account = privateKeyToAccount(hex);
  const rpc = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;

  const publicClient = createPublicClient({ chain: mainnet, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: mainnet, transport: http(rpc) });

  let approveTxHash: `0x${string}` | undefined;

  const isErc20In = tokenIn !== 'ETH' && tokenIn !== 'WETH';
  if (isErc20In) {
    const tokenAddress = TOKEN_ADDRESSES[tokenIn];
    if (!tokenAddress) throw new Error(`No address for token: ${tokenIn}`);

    onStatus('checking-allowance');
    const allowance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, routerAddress],
    });

    if (allowance < amountInRaw) {
      onStatus('approving');
      approveTxHash = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [routerAddress, maxUint256],
      });

      onStatus('waiting-approve');
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
    }
  }

  onStatus('swapping');
  const swapTxHash = await walletClient.sendTransaction({
    to: routerAddress,
    data: calldata,
    value,
  });

  onStatus('waiting-swap');
  await publicClient.waitForTransactionReceipt({ hash: swapTxHash });
  onStatus('confirmed');

  return { swapTxHash, approveTxHash };
}
