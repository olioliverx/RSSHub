import type { Context } from 'hono';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';

import type { AvailabilityState, CopyStatus } from './utils';
import { buildStatusDescription, fetchBookStatus, formatPrimaryStatus, resolveRecordTitle } from './utils';

interface StoredState {
    state: AvailabilityState;
    notifiedAt?: string;
    availabilityKey?: string;
}

const STATE_CACHE_TTL = 60 * 60 * 24 * 30;

function buildAvailabilityKey(copies: CopyStatus[]): string {
    return copies
        .filter((copy) => copy.borrowable)
        .map((copy) => `${copy.location}|${copy.callNumber}|${copy.status}`)
        .toSorted()
        .join(';');
}

async function getStoredState(recordId: string): Promise<StoredState | undefined> {
    const raw = await cache.get(`shlibrary:state:${recordId}`, false);
    if (!raw) {
        return undefined;
    }
    try {
        return JSON.parse(raw) as StoredState;
    } catch {
        return undefined;
    }
}

async function setStoredState(recordId: string, state: StoredState): Promise<void> {
    await cache.set(`shlibrary:state:${recordId}`, state, STATE_CACHE_TTL);
}

export const route: Route = {
    path: '/record/:id',
    name: '馆藏可借提醒',
    url: 'vufind.library.sh.cn',
    maintainers: ['olioliverx'],
    example: '/shlibrary/record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9',
    parameters: {
        id: '书目 record ID，可在 https://vufind.library.sh.cn/Record/<id> 链接中找到',
    },
    description: `监控上海图书馆 VuFind 单本书的可借状态。当该书**变为可借**时，路由才会产生新的 RSS 条目，适合配合 [RSS-to-Telegram-Bot](https://github.com/Rongronggg9/RSS-to-Telegram-Bot) 推送到 Telegram。

**添加监控：** 在 RSS-to-Telegram-Bot 中订阅本路由，例如：
\`/sub https://your-rsshub.app/shlibrary/record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9\`

**取消监控：** 在 RSS-to-Telegram-Bot 中取消订阅对应链接，例如：
\`/unsub https://your-rsshub.app/shlibrary/record/67b350c3-8fa8-42a4-ae13-7ab92e4c89e9\`

record ID 可在登录 [My Favorites](https://vufind.library.sh.cn/MyResearch/Favorites) 后，从每本书详情页 URL 复制。

可选查询参数：

- \`title=书名\`：当上海图书馆标题接口不可达时手动指定书名。
- \`mode=status\`：始终返回当前状态（调试用，可能会重复推送，不建议用于 Telegram 订阅）。`,
    categories: ['reading'],
    radar: [
        {
            source: ['vufind.library.sh.cn/Record/:id'],
            target: '/record/:id',
        },
    ],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler,
};

async function handler(ctx: Context): Promise<Data> {
    const recordId = ctx.req.param('id');
    const mode = ctx.req.query('mode') ?? 'alert';
    const titleHint = ctx.req.query('title');

    // Status is the source of truth and must succeed; title resolution
    // falls back to the record ID internally, so it can never fail the route.
    const [status, title] = await Promise.all([fetchBookStatus(recordId), resolveRecordTitle(recordId, titleHint)]);
    const link = status.link;

    let items: DataItem[] = [];

    if (mode === 'status') {
        const statusLabel = formatPrimaryStatus(status.state === 'available' ? status.borrowableCopies : status.allCopies);
        items = [
            {
                title: `${title} — ${statusLabel}`,
                link,
                description: buildStatusDescription(status),
                guid: `shlibrary:status:${recordId}:${status.checkedAt}`,
                pubDate: status.checkedAt,
            },
        ];
    } else if (status.state === 'available') {
        const previous = await getStoredState(recordId);
        const availabilityKey = buildAvailabilityKey(status.borrowableCopies);

        // Skip when already notified for this availability spell — keep feed empty.
        const alreadyNotified = previous?.state === 'available' && previous.availabilityKey === availabilityKey;
        if (!alreadyNotified) {
            const notifiedAt = status.checkedAt;
            await setStoredState(recordId, {
                state: 'available',
                notifiedAt,
                availabilityKey,
            });

            items = [
                {
                    title: `${title} — ${formatPrimaryStatus(status.borrowableCopies)}`,
                    link,
                    description: buildStatusDescription(status),
                    guid: `shlibrary:available:${recordId}:${availabilityKey || 'unknown'}`,
                    pubDate: notifiedAt,
                },
            ];
        }
    } else {
        await setStoredState(recordId, {
            state: status.state,
        });
    }

    return {
        title: `上海图书馆 - ${title}`,
        link,
        description: `上海图书馆 ${title} 可借状态提醒`,
        language: 'zh-CN',
        allowEmpty: true,
        item: items,
    };
}
