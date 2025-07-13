// utils/ft-transfers.js
import fetch from 'node-fetch';

const FT_TRANSFERS_URL = 'https://dialog-tbot.com/history/ft-transfers/';
const SYMBOL           = 'YUM';
const DEFAULT_LIMIT    = 200;

export async function fetchFtSums(walletId, startNano = null, endNano = null) {
    const ftSums   = {};
    let offset     = 0;
    let totalCount = Infinity;

    while (offset < totalCount) {
        const url = new URL(FT_TRANSFERS_URL);
        url.searchParams.set('wallet_id', walletId);
        url.searchParams.set('direction', 'in');
        url.searchParams.set('symbol',    SYMBOL);
        url.searchParams.set('limit',     String(DEFAULT_LIMIT));
        url.searchParams.set('skip',      String(offset));

        const resp = await fetch(url.toString());
        if (!resp.ok) break;
        const json = await resp.json();

        if (typeof json.total === 'number') {
            totalCount = json.total;
        }

        const batch = Array.isArray(json.ft_transfers) ? json.ft_transfers : [];
        for (const tx of batch) {
            // фильтруем по временному диапазону, если он задан
            if (startNano !== null || endNano !== null) {
                if (!tx.timestamp_nanosec) continue;
                const ts = BigInt(tx.timestamp_nanosec);
                if (startNano !== null && ts < startNano) continue;
                if (endNano   !== null && ts > endNano)   continue;
            }
            const from = tx.sender_id;
            const amt  = BigInt(tx.args?.amount ?? tx.amount ?? '0');
            ftSums[from] = (ftSums[from] || 0n) + amt;
        }

        offset += DEFAULT_LIMIT;
    }

    return ftSums; // { [sender_id]: BigInt(sum) }
}
