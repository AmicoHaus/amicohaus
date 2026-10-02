# Amico Haus

**Local agent experts weigh in on your home's price — before you list.**

[amicohaus.com](https://amicohaus.com) · [Live demo](https://amicohaus.com/demo)

## The problem

Before a home goes on the market, the homeowner usually gets one opinion on price: whichever agent they happen to talk to first. There's no easy way to hear from several local agents at once, see how their proposed strategies actually differ, and pick one on the merits — so people either skip that step or go through it the slow way, one phone call at a time.

## What Amico Haus does — "Agent Strategy"

A homeowner posts a **pre-listing showcase**: basic details, photos, an asking price, and a few preferences (local specialist, language, minimum experience). From there:

1. **Local agent experts evaluate the price.** Approved agents vote too high / too low / about right — an opinion, never an appraisal. The tally also shows how many of those votes came from agents whose service area actually covers the home, so "local expert" is a fact, not a claim.
2. **Agents share their strategy.** Each proposes a fee, what's included, and how fast they can start.
3. **The homeowner compares and chooses** — ratings, response time, and the proposed strategy side by side.
4. **Both sides review each other** once the work is done, the same as any real engagement.

No payments run through the platform — fees are handled directly between the two parties, the way they would be anyway. Homeowners who'd rather trade their home for another than sell it outright can do that too, still with a licensed agent involved.

## Built by

Presented by **Rudy Flores**, Real Estate Strategist with the McKelvey Team at Coldwell Banker West (DRE #02257808), working buyers and sellers throughout San Diego County. Amico Haus grew out of one recurring problem he kept seeing firsthand: homeowners committing to an agent and a price without ever really comparing either one.

## Stack

- **Cloudflare Pages + Pages Functions** — static front end, serverless API routes
- **D1** (SQLite at the edge) for data, **R2** for photos
- Plain HTML/CSS/JS front end — no framework, no build step beyond content-hash asset versioning
- Magic-link email signup (no passwords sent, no password required until the link is confirmed)
- A two-user authorization test suite (`tools/authz-test.js`) that runs against production after every change and checks who can see and touch what

## Try it

- **[/demo](https://amicohaus.com/demo)** walks through the whole flow with fictional agents and listings — the fastest way to see what it does.
- The live site's home page only ever shows real counts, never demo data — `/api/public-stats` is the source of truth for "how many agents, listings, and open requests exist right now."

## Status

Early. The product, authorization model, and signup flow are built and tested end to end; what's next is the first real agents and homeowners actually using it. Current real counts are visible live at [amicohaus.com](https://amicohaus.com).
