import type { AvailabilityEvent } from './types.js';

export async function sendTelegramNotification(options: {
    botToken: string;
    chatId: string;
    event: AvailabilityEvent;
}): Promise<void> {
    const { botToken, chatId, event } = options;
    const copyLines = event.copies
        .slice(0, 5)
        .map((copy) => {
            const location = copy.location || 'Unknown location';
            const callNumber = copy.callNumber ? ` (${copy.callNumber})` : '';
            return `• ${location}${callNumber}: ${copy.status}`;
        })
        .join('\n');

    const text = [`📚 ${event.title} is available to borrow`, '', event.summary, copyLines, '', event.link].filter(Boolean).join('\n');

    const body = new URLSearchParams({
        chat_id: chatId,
        text,
        disable_web_page_preview: 'false',
    });

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        body,
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Telegram notification failed: HTTP ${response.status} ${detail}`);
    }
}
