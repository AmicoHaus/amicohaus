// /t/<video-id> and /t/<video-id>/agents: TikTok short links for video captions (see functions/_lib/shortLinks.js).
import { shortLinkRedirect } from '../_lib/shortLinks.js';

export const onRequest = (context) => shortLinkRedirect(context, 't');
