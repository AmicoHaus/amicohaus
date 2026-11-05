// /y/<video-id> and /y/<video-id>/agents: YouTube short links for video captions (see functions/_lib/shortLinks.js).
import { shortLinkRedirect } from '../_lib/shortLinks.js';

export const onRequest = (context) => shortLinkRedirect(context, 'y');
