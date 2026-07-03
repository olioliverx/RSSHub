import type { Context } from 'hono';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';

import type { AvailabilityState } from './utils';
import { buildStatusDescription, fetchBookStatus, fetchRecordTitle } from './utils';

interface StoredState {
    state: AvailabilityState;
    notifiedAt?: string;
}

const STATE_CACHE_TTL = 60 * 60 * 24 * 30;

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

function setStoredState(recordId: string, state: StoredState): void {
    cache.set(`shlibrary:state:${recordId}`, state, STATE_CACHE_TTL);
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

可选参数 \`mode=status\` 会始终返回当前状态（调试用，可能会重复推送，不建议用于 Telegram 订阅）。`,
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
        antiCrawler: false,
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

    const title = await fetchRecordTitle(recordId);
    const status = await fetchBookStatus(recordId, title);
    const link = status.link;

    let items: DataItem[] = [];

    if (mode === 'status') {
        items = [
            {
                title: `${title} — ${status.state}`,
                link,
                description: buildStatusDescription(status),
                guid: `shlibrary:status:${recordId}:${status.checkedAt}`,
                pubDate: status.checkedAt,
            },
        ];
    } else {
        const previous = await getStoredState(recordId);
        const becameAvailable = status.state === 'available' && previous?.state !== 'available';

        if (becameAvailable) {
            const notifiedAt = status.checkedAt;
            setStoredState(recordId, {
                state: 'available',
                notifiedAt,
            });

            items = [
                {
                    title: `${title} 现在可借`,
                    link,
                    description: buildStatusDescription(status),
                    guid: `shlibrary:available:${recordId}:${notifiedAt}`,
                    pubDate: notifiedAt,
                },
            ];
        } else if (status.state !== 'available') {
            setStoredState(recordId, {
                state: status.state,
            });
        }
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
