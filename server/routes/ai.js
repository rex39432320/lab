import { tooMany } from '../lib/errors.js';
import { v } from '../lib/validate.js';
import { answerChat } from '../services/chat.js';

export function registerAi(router, { store, ai, limiter }) {
  router.get('/api/ai/status', () => ({ enabled: ai.enabled, model: ai.model, mode: ai.enabled ? 'gemini' : 'local' }));

  router.post('/api/ai/chat', async ({ body, user, now }) => {
    const hit = limiter.hit(`chat:${user.id}`, 30, 60_000);
    if (!hit.allowed) throw tooMany('You are sending messages too quickly.', hit.retryAfterSec);
    const text = v.string(v.object(body).message, 'message', { max: 400 });
    return { ...(await answerChat({ store, user, now, text, ai })), mode: ai.enabled ? 'gemini' : 'local' };
  });
}
