import fetch from 'node-fetch';
import { fetchYUMTransfers } from './yum-rewards.js';

const TRANSFERS_URL = 'https://dialog-tbot.com/history/nft-transfers/';
const UNIQUE_REPUTATION_URL = 'https://dialog-tbot.com/nft/unique-reputation/';
const DEFAULT_LIMIT = 200;
const DEFAULT_SKIP = 0;

export default async function handler(req, res) {
    const walletId = req.query.wallet_id;
    const limit = Number(req.query.limit) || DEFAULT_LIMIT;
    const skip = Number(req.query.skip) || DEFAULT_SKIP;

    // direction: 'in' или 'out', по умолчанию 'in'
    const direction = req.query.direction === 'out' ? 'out' : 'in';

    // Обработка параметра symbol с проверкой по списку разрешённых значений
    const allowedSymbols = ['YUM', 'GRECHA', 'NEAR', 'Darai', 'HOPE', 'YUPLAND', 'NTDarai', 'JHOLUDI'];
    const symbolParam = typeof req.query.symbol === 'string' ? req.query.symbol : 'YUM';
    const symbol = allowedSymbols.includes(symbolParam) ? symbolParam : 'YUM';

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
        const allTransfers = [];
        const nftFirstTs = {};
        let offset = skip;
        let totalCount = Infinity;

        do {
            const url = new URL(TRANSFERS_URL);
            url.searchParams.set('wallet_id', walletId);
            url.searchParams.set('direction', direction);
            url.searchParams.set('limit', String(limit));
            url.searchParams.set('skip', String(offset));

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
                    if (endNano !== null && ts > endNano) return;
                }

                allTransfers.push(tx);

                const from = tx.sender_id;
                const to = tx.args?.receiver_id;

                // Ключ группировки зависит от направления
                const key = direction === 'out' ? to : from;
                const ts = BigInt(tx.timestamp_nanosec);
                if (key && (!nftFirstTs[key] || ts < BigInt(nftFirstTs[key]))) {
                    nftFirstTs[key] = tx.timestamp_nanosec;
                }
            });

            offset += limit;
        } while (offset < totalCount);

        // Получаем данные по репутации NFT
        const repResp = await fetch(UNIQUE_REPUTATION_URL);
        const repMap = {};
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

        // Группируем данные по ключу (отправитель или получатель)
        const byKey = {};
        allTransfers.forEach(tx => {
            const from = tx.sender_id;
            const to = tx.args?.receiver_id;
            const title = (tx.args?.title || '').trim().toLowerCase();
            if (!title) return;
            const rep = repMap[title] || 0;

            const key = direction === 'out' ? to : from;
            if (!key) return;

            if (!byKey[key]) {
                byKey[key] = { total: 0, nftCount: 0, tokens: {} };
            }

            byKey[key].total += rep;
            byKey[key].nftCount += 1;

            if (!byKey[key].tokens[title]) {
                byKey[key].tokens[title] = { title, count: 0, rep, totalRep: 0 };
            }
            const rec = byKey[key].tokens[title];
            rec.count += 1;
            rec.totalRep = rec.count * rec.rep;
        });

        // Получаем FT-трансферы для выбранного токена symbol
        const yumTransfers = await fetchYUMTransfers(walletId, symbol, 200, startNano, endNano, direction);
        const yumByKey = {};

        yumTransfers.forEach(tx => {
            const from = tx.from;
            const to = tx.to || null;
            const key = direction === 'out' ? to : from;
            if (!key) return;
            if (!yumByKey[key]) yumByKey[key] = 0;
            yumByKey[key] += tx.amount;
        });

        // Объединяем ключи из NFT и YUM для формирования итогового leaderboard
        const allKeys = new Set([...Object.keys(byKey), ...Object.keys(yumByKey)]);

        let leaderboard = Array.from(allKeys).map(key => {
            const nftData = byKey[key] || { total: 0, nftCount: 0, tokens: {} };
            return {
                wallet: key,
                total: nftData.total,
                nftCount: nftData.nftCount,
                tokens: Object.values(nftData.tokens),
                yum: yumByKey[key] || 0,
                firstNftTs: nftFirstTs[key] || null
            };
        });

        // Сортируем по дате первой NFT трансфера
        leaderboard.sort((a, b) => {
            if (!a.firstNftTs) return 1;
            if (!b.firstNftTs) return -1;
            const tsA = BigInt(a.firstNftTs);
            const tsB = BigInt(b.firstNftTs);
            if (tsA < tsB) return -1;
            if (tsA > tsB) return 1;
            return 0;
        });

        return res.status(200).json({ leaderboard });

    } catch (err) {
        console.error('❌ Error in nft-reputation handler:', err);
        return res.status(500).json({ error: err.message, stack: err.stack });
    }
}
