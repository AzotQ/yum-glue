export async function fetchYUMTransfers(walletId, symbol = 'YUM', batch = DEFAULT_LIMIT, startNano = null, endNano = null, direction = 'in') {
    const all = [];
    for (let skip = 0; ; skip += batch) {
        const url = new URL(BASE_URL);
        url.searchParams.set('wallet_id', walletId);
        url.searchParams.set('direction', direction);
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

    return all
        .filter(tx => {
            const ts = BigInt(tx.timestamp_nanosec || 0);
            if (startNano !== null && ts < startNano) return false;
            if (endNano !== null && ts > endNano) return false;
            return true;
        })
        .map(tx => {
            const decimals = Number(tx.decimals || 0);
            const raw = BigInt(tx.amount || '0');
            const amount = Number(raw) / 10 ** decimals;
            // Возвращаем from и to для возможности группировки
            return { from: tx.from, to: tx.to || null, amount };
        });
}
