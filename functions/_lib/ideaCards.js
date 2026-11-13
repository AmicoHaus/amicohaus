// Idea cards (nuanced ideas batch): the short explainer cards for the nuanced-ideas tools. Each lists options in plain
// words, ends with "General information. Not legal advice." and the "check your HOA and city" line (ideaText.js
// HOA_CITY_LINE), and never recommends one. No card says what a use pays, promises income or value, calls anything
// legal or allowed, or names a company or an attorney. A card shows only when its tool is live for the viewer
// (nuancedGate.js). Draft copy: the attorney and Rudy read every card before a dark tool is turned on.
import { HOA_CITY_LINE } from './ideaText.js';
import { toolLive } from './nuancedGate.js';
import { TERM_OPTIONS } from './dealOutlines.js';
import { OPEN_FOR_USES, LIGHT_LINE, LONG_LINE, TAX_LINE, NO_PAY_LINE } from './openFor.js';

export const GENERAL_INFO_LINE = 'General information. Not legal advice.';

// Lines owned by other files, repeated here word for word so this file loads by itself (tools/land-ideas-test.mjs
// fails when one drifts from listingTerms.js, stepDown.js, tradeTrials.js or watchAreas.js).
export const CARD_SHARED_LINES = {
  SELL_STAY_NOTE: 'Your agents write the rent-back terms. No rent amounts are set on Amico Haus.',
  STEP_DOWN_LINE: "The owner published this schedule and can change or stop it at any time. It isn't an auction: there is no bidding, no deadline and no winner, and nothing sells by itself. An offer made on this page is a private note to the owner, who can say yes or no at any price. Each price is the owner's own number, not an appraisal.",
  TRIAL_LINE: "A trial stay is between the two of you. Amico Haus only records that you both said yes, the dates and this checklist. That record isn't a contract, and Amico Haus doesn't provide one, handle money or share addresses.",
  TRIAL_LONG_LINE: 'A stay of 30 days or more can create a tenancy with tenant protections, and your lender, insurer, HOA and city may each have a say. Have an attorney write your agreement first.',
  WATCH_OPEN_LINE: "Anyone with an account can watch any ZIP code. You don't have to live there.",
  WATCH_PRECISION_LINE: 'For now a watch area is a whole ZIP code.',
};
const S = CARD_SHARED_LINES;
const notes = (option) => TERM_OPTIONS[option].notes;
const useNotes = (key) => OPEN_FOR_USES[key].notes;

// A line on a LIVE tool's card that is still on the attorney's list shows only to admin accounts until its item is
// cleared here (one word, then a deploy Rudy approves). A10 = the Sell and stay "30 days or more" note.
export const CARD_REVIEW_CLEARED = { A10: false };
function reviewCleared(env, user, item) {
  return CARD_REVIEW_CLEARED[item] === true || (!!env && env.NUANCED_ALL_LIVE === '1') || (!!user && user.role === 'admin');
}

// key, tool (the gate that shows the card), title, body (paragraphs), lines (the notes under it). A body entry may be
// { text, tool }: that paragraph shows only when that tool is live for the viewer too. A line may be { text, review }:
// it waits for that attorney item (above). link and action are optional. titleWhen = { tool, title }: the title
// used instead while that tool is live for the viewer too.
export const IDEA_CARDS = [
  {
    key: 'corner', tool: 'easementIdeas', title: 'Let someone use a corner of your lot',
    body: ['A parking pad, a side yard or a garage bay can be used by someone else month to month. You stay the owner and either side can end it with notice. It is a permission, not a lease.'],
    lines: [...notes('month_to_month')],
  },
  {
    key: 'across', tool: 'easementIdeas', title: 'Share a driveway or a side path',
    body: ['Neighbors often share a way across. It can start as a simple written permission. Making it permanent means a recorded easement, which an attorney writes and a surveyor describes.'],
    lines: [],
  },
  { key: 'permanent', tool: 'easementIdeas', title: 'When a neighbor wants something permanent', body: [], lines: [...notes('recorded_easement')] },
  { key: 'long', tool: 'easementIdeas', title: 'Long leases', body: [], lines: [...notes('long_lease')] },
  {
    key: 'together', tool: 'easementIdeas', title: 'Owning a home with 1 to 3 other people', body: [],
    lines: [...notes('co_2_4'), 'Five or more ownership shares need a state filing. Not offered here.'],
  },
  {
    key: 'tower', tool: 'openFor', title: 'How tower and solar leases work',
    body: ["Before real estate, I worked on cell-tower leases, so here is the plain version. A company leases a small piece of a property for many years, with renewals. Because it runs so long, it needs an attorney, your lender's consent if you have a mortgage, and a look at the property tax rule."],
    lines: [LONG_LINE, TAX_LINE, NO_PAY_LINE],
  },
  {
    key: 'buyout', tool: 'openFor', title: 'Lease buyouts, in plain words',
    body: ["Sometimes one buyer offers a single payment to take over the rent from a tower or solar lease. It is a sale of a property right, so it is an attorney's document, and your lender is involved. Amico Haus doesn't list buyouts, shares of rent or anything sold for a return."],
    lines: [],
  },
  {
    key: 'minerals', tool: 'openFor', title: "What's under your land",
    body: ['You may not own the mineral rights under your land. A title company can tell you.', "Mineral, oil and gas deals are long leases with their own state rules, and new wells aren't permitted near homes. Amico Haus doesn't list them."],
    lines: [],
  },
  {
    key: 'light', tool: 'openFor', title: 'Filming, events, storage, gardens', body: [],
    lines: [LIGHT_LINE, ...useNotes('filming'), ...useNotes('events'), ...useNotes('storage_parking')],
  },
  {
    key: 'stay', tool: 'sellAndStay', title: 'Sell and stay',
    body: ['Want to sell and stay a little while? Say so up front.'],
    lines: [
      'Up to 29 days (the default): a short rent-back. Your agents write the terms.',
      { text: "30 days or more (an option, not set on Amico Haus): that is a lease-back. It uses a lease form and creates a tenancy with tenant protections, the buyer's loan may require them to move in within a set time, and your agents (and for a long stay an attorney) write it.", review: 'A10' },
      S.SELL_STAY_NOTE,
    ],
    action: 'stay',
  },
  {
    key: 'carry', tool: 'ownerCarry', title: 'Owner will carry, and assumable loans',
    body: ["Some owners are open to carrying a note, and some loans (many FHA, VA and USDA loans) can be taken over by a buyer if the loan servicer approves. On Amico Haus an owner can only say yes or no to each. Rates, amounts and payments are never posted here: they're worked out with your agents and a licensed loan professional, under federal and state lending rules."],
    lines: [], link: { href: '/assumable-loans', label: 'About assumable loans' },
  },
  {
    key: 'trial', tool: 'testDrive', title: 'Test-drive a trade',
    body: ["Before you commit to a trade, the two of you can try staying in each other's homes for a short time. The default is up to 29 nights: you pick the dates and each tick a short checklist."],
    lines: [S.TRIAL_LINE, `Longer stays are an option with one more note: ${S.TRIAL_LONG_LINE}`],
  },
  {
    key: 'steps', tool: 'stepDown', title: 'A price that steps down on a schedule',
    body: ['You can publish a price that steps down on dates you choose. Buyers see every step. You can change or stop it any time.'],
    lines: [S.STEP_DOWN_LINE],
  },
  {
    // Named for the head start only while the head start is on for the viewer: until then the card is about
    // watching a ZIP code and nothing is shown "first" to anyone.
    key: 'first', tool: 'watchAreas', title: 'Watch a ZIP code', titleWhen: { tool: 'headStart', title: 'Neighbors first' },
    body: [
      "Watch up to 3 ZIP codes and see what's new there in one place.",
      // The head start has its own gate (CB West reads the wording first), so its sentence waits for that gate.
      { text: 'When an owner chooses a head start, members who watch that ZIP code see the home before everyone else.', tool: 'headStart' },
    ],
    lines: [S.WATCH_OPEN_LINE, S.WATCH_PRECISION_LINE],
  },
];

// The cards this viewer sees: only live tools' cards, each ending with the two closing lines.
export function ideaCardsFor(env, user) {
  return IDEA_CARDS.filter(c => toolLive(env, c.tool, user)).map(c => ({
    key: c.key, tool: c.tool, title: c.titleWhen && toolLive(env, c.titleWhen.tool, user) ? c.titleWhen.title : c.title,
    body: c.body.filter(b => typeof b === 'string' || toolLive(env, b.tool, user)).map(b => (typeof b === 'string' ? b : b.text)),
    lines: [...c.lines.filter(l => typeof l === 'string' || reviewCleared(env, user, l.review)).map(l => (typeof l === 'string' ? l : l.text)), GENERAL_INFO_LINE, HOA_CITY_LINE],
    ...(c.link ? { link: c.link } : {}), ...(c.action ? { action: c.action } : {}),
  }));
}
