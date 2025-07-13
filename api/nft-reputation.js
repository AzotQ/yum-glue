// api/nft-reputation.js
import fetch from 'node-fetch';

const TRANSFERS_URL         = 'https://dialog-tbot.com/history/nft-transfers/';
const UNIQUE_REPUTATION_URL = 'https://dialog-tbot.com/nft/unique-reputation/';
const DEFAULT_LIMIT         = 200;
const DEFAULT_SKIP          = 0;

export default async function handler(req, res) {
    const walletId = req.query.wallet_id;
    const limit    = Number(req.query.limit) || DEFAULT_LIMIT;
    const skip     = Number(req.query.skip)  || DEFAULT_SKIP;

    // 1) Парсим опциональный фильтр по дате (ISO-строки)
    let startNano = null, endNano = null;
    if (req.query.start_time) {
        const d = Date.parse(req.query.start_time);
        if (!Number.isNaN(d)) startNano = BigInt(d) * 1_000_000n;
    }
    if (req.query.end_time) {
        const d = Date.parse(req.query.end_time);
        if (!Number.isNaN(d)) endNano = BigInt(d) * 1_000_000n;
    }

    if (!walletId) {
        return res.status(400).json({ error: 'Parameter wallet_id is required' });
    }

    try {
        // 2) Собираем все входящие NFT-трансферы по пагинации
        const allTransfers = [];
        let offset     = skip;
        let totalCount = Infinity;

        do {
            const url = new URL(TRANSFERS_URL);
            url.searchParams.set('wallet_id', walletId);
            url.searchParams.set('direction',  'in');
            url.searchParams.set('limit',      String(limit));
            url.searchParams.set('skip',       String(offset));

            const resp = await fetch(url.toString());
            if (!resp.ok) break;
            const json = await resp.json();
            if (typeof json.total === 'number') totalCount = json.total;

            const batch = Array.isArray(json.nft_transfers) ? json.nft_transfers : [];
            if (!batch.length) break;

            batch.forEach(tx => {
                if (tx.method !== 'nft_transfer') return;
                if (startNano !== null || endNano !== null) {
                    if (!tx.timestamp_nanosec) return;
                    const ts = BigInt(tx.timestamp_nanosec);
                    if (startNano !== null && ts < startNano) return;
                    if (endNano   !== null && ts > endNano)   return;
                }
                allTransfers.push(tx);
            });

            offset += limit;
        } while (offset < totalCount);

        // 3) Загружаем карту title→reputation
        const repResp = await fetch(UNIQUE_REPUTATION_URL);
        const repMap  = {};
        if (repResp.ok) {
            const repJson = await repResp.json();
            const records = Array.isArray(repJson.nfts) ? repJson.nfts : [];
            records.forEach(item => {
                if (typeof item.title === 'string' && typeof item.reputation === 'number') {
                    repMap[item.title.trim().toLowerCase()] = item.reputation;
                }
            });
        } else {
            console.warn(`Unique-reputation API returned ${repResp.status}`);
        }

        // 4) Группируем по sender_id, считаем суммарную репутацию и общее число NFT
        const bySender = {};
        allTransfers.forEach(tx => {
            const from  = tx.sender_id;
            const title = (tx.args?.title || '').trim().toLowerCase();
            if (!title) return;
            const rep = repMap[title] || 0;

            if (!bySender[from]) {
                bySender[from] = { total: 0, nftCount: 0, tokens: {} };
            }
            // наращиваем репутацию и счётчик переводов
            bySender[from].total    += rep;
            bySender[from].nftCount += 1;

            // собираем детали по каждому title
            if (!bySender[from].tokens[title]) {
                bySender[from].tokens[title] = { title, count: 0, rep, totalRep: 0 };
            }
            const rec = bySender[from].tokens[title];
            rec.count    += 1;
            rec.totalRep  = rec.count * rec.rep;
        });

        // 5) Формируем итоговый массив и сортируем по репутации (desc)
        const leaderboard = Object.entries(bySender)
            .map(([wallet, { total, nftCount, tokens }]) => ({
                wallet,
                total,
                nftCount,
                tokens: Object.values(tokens)
            }))
            .sort((a, b) => b.total - a.total);

        return res.status(200).json({ leaderboard });

    } catch (err) {
        console.error('Error in nft-reputation handler:', err);
        return res.status(500).json({ error: err.message });
    }
}
