// api/yum-rewards.js
import fetch from 'node-fetch';

const BASE_URL = 'https://dialog-tbot.com/history/ft-transfers/';
const DEFAULT_LIMIT = 100;
const DEFAULT_SKIP  = 0;

export async function fetchYUMTransfers(walletId, symbol = 'YUM', batch = 200) {
    const all = [];
    for (let skip = 0; ; skip += batch) {
        const url = new URL(BASE_URL);
        url.searchParams.set('wallet_id', walletId);
        url.searchParams.set('direction', 'in');
        url.searchParams.set('symbol', symbol);
        url.searchParams.set('limit', batch);
        url.searchParams.set('skip', skip);

        const resp = await fetch(url.toString());
        if (!resp.ok) throw new Error(`Upstream error ${resp.status}`);
        const { transfers } = await resp.json();
        if (!Array.isArray(transfers) || transfers.length === 0) break;

        all.push(...transfers);
        if (transfers.length < batch) break;
    }
    return all;
}
