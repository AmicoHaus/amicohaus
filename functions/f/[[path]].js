// /f/<video-id> and /f/<video-id>/agents: Facebook short links for video captions (see functions/_lib/shortLinks.js).
import { shortLinkRedirect } from '../_lib/shortLinks.js';

export const onRequest = (context) => shortLinkRedirect(context, 'f');
