// api/nft-reputation.js
import fetch from 'node-fetch';

const TRANSFERS_URL         = 'https://dialog-tbot.com/history/nft-transfers/';
const FT_TRANSFERS_URL      = 'https://dialog-tbot.com/history/ft-transfers/';
const UNIQUE_REPUTATION_URL = 'https://dialog-tbot.com/nft/unique-reputation/';
const SYMBOL                = 'YUM';
const DEFAULT_LIMIT         = 200;
const DEFAULT_SKIP          = 0;

export default async function handler(req, res) {
    const walletId = req.query.wallet_id;
    const limit    = Number(req.query.limit) || DEFAULT_LIMIT;
    const skip     = Number(req.query.skip)  || DEFAULT_SKIP;

    // парсим период (ISO) → наносекунды
    let startNano = null, endNano = null;
    if (req.query.start_time) {
        const d = Date.parse(req.query.start_time);
        if (!isNaN(d)) startNano = BigInt(d) * 1_000_000n;
    }
    if (req.query.end_time) {
        const d = Date.parse(req.query.end_time);
        if (!isNaN(d)) endNano = BigInt(d) * 1_000_000n;
    }

    if (!walletId) {
        return res.status(400).json({ error: 'Parameter wallet_id is required' });
    }

    try {
        // 1) NFT-трансферы (method=nft_transfer)
        const nftTransfers = [];
        let offset     = skip;
        let totalNFT   = Infinity;
        do {
            const url = new URL(TRANSFERS_URL);
            url.searchParams.set('wallet_id', walletId);
            url.searchParams.set('direction',  'in');
            url.searchParams.set('limit',      String(limit));
            url.searchParams.set('skip',       String(offset));
            const resp = await fetch(url);
            if (!resp.ok) break;
            const json = await resp.json();
            if (typeof json.total === 'number') totalNFT = json.total;
            const batch = Array.isArray(json.nft_transfers) ? json.nft_transfers : [];
            if (!batch.length) break;
            for (const tx of batch) {
                if (tx.method !== 'nft_transfer') continue;
                if (startNano !== null || endNano !== null) {
                    if (!tx.timestamp_nanosec) continue;
                    const ts = BigInt(tx.timestamp_nanosec);
                    if (startNano !== null && ts < startNano) continue;
                    if (endNano   !== null && ts > endNano)   continue;
                }
                nftTransfers.push(tx);
            }
            offset += limit;
        } while (offset < totalNFT);

        // 2) FT-трансферы YUM: sum(amount) по sender_id
        const ftSums = {};
        offset     = skip;
        let totalFT = Infinity;
        do {
            const url = new URL(FT_TRANSFERS_URL);
            url.searchParams.set('wallet_id', walletId);
            url.searchParams.set('direction',  'in');
            url.searchParams.set('symbol',     'YUM');
            url.searchParams.set('limit',      String(limit));
            url.searchParams.set('skip',       String(offset));
            const resp = await fetch(url);
            if (!resp.ok) break;
            const json = await resp.json();
            if (typeof json.total === 'number') totalFT = json.total;
            const batch = Array.isArray(json.ft_transfers) ? json.ft_transfers : [];
            for (const tx of batch) {
                const from = tx.sender_id;
                const amt  = BigInt(tx.args?.amount ?? tx.amount ?? '0');
                ftSums[from] = (ftSums[from] || 0n) + amt;
            }
            offset += limit;
        } while (offset < totalFT);

        // 3) Репутации
        const repResp = await fetch(UNIQUE_REPUTATION_URL);
        const repMap  = {};
        if (repResp.ok) {
            const repJson = await repResp.json();
            const recs    = Array.isArray(repJson.nfts) ? repJson.nfts : [];
            for (const item of recs) {
                if (typeof item.title === 'string' && typeof item.reputation === 'number') {
                    repMap[item.title.trim().toLowerCase()] = item.reputation;
                }
            }
        }

        // 4) Группируем по sender_id
        const bySender = {};
        for (const tx of nftTransfers) {
            const from  = tx.sender_id;
            const title = (tx.args?.title || '').trim().toLowerCase();
            if (!title) continue;
            const rep   = repMap[title] || 0;

            if (!bySender[from]) {
                bySender[from] = {
                    wallet:   from,
                    total:    0,
                    nftCount: 0,
                    yumCount: 0n,
                    tokens:   {}
                };
            }
            bySender[from].total    += rep;
            bySender[from].nftCount += 1;

            if (!bySender[from].tokens[title]) {
                bySender[from].tokens[title] = { title, count: 0, rep, totalRep: 0 };
            }
            const rec = bySender[from].tokens[title];
            rec.count    += 1;
            rec.totalRep  = rec.count * rec.rep;
        }
        // вписываем YUM-суммы
        for (const from in bySender) {
            bySender[from].yumCount = ftSums[from] || 0n;
        }

        // 5) Формируем финальный массив и сортируем по репутации (desc)
        const leaderboard = Object.values(bySender)
            .map(item => ({
                wallet:   item.wallet,
                nftCount: item.nftCount,
                yumCount: Number(item.yumCount),
                total:    item.total,
                tokens:   Object.values(item.tokens)
            }))
            .sort((a, b) => b.total - a.total);

        return res.status(200).json({ leaderboard });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
}
