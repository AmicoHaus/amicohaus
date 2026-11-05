// /i/<video-id> and /i/<video-id>/agents: Instagram short links for video captions (the Instagram caption also goes
// out on the Facebook cross-post). See functions/_lib/shortLinks.js.
import { shortLinkRedirect } from '../_lib/shortLinks.js';

export const onRequest = (context) => shortLinkRedirect(context, 'i');
