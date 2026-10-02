// Loads the real parseAppLink/openAppLink/openNotification out of main.js into a stubbed sandbox and checks where each kind of notification/deep link leads. Usage: node tools/applink-test.js main.js
// and checks where each kind of notification link leads.
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(process.argv[2], 'utf8');

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  const from = src.lastIndexOf('\n', start) + 1;
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(from, i + 1);
}
// the named-section constants that openAppLink reads, then the functions themselves
const consts = src.slice(src.indexOf('const AGENT_TAB_SECTIONS'), src.indexOf('function openAgentTabSection'));
const code = consts + ['openAgentTabSection', 'parseAppLink', 'openAppLink', 'openNotification'].map(grab).join('\n\n');

const log = [];
const sandbox = {
  window: { location: { set href(v) { log.push(['navigate', v]); } } },
  document: { getElementById: id => ({ tagName: /Wrap$/.test(id) ? 'DETAILS' : 'H2', set open(v) { log.push(['open', id, v]); }, scrollIntoView: () => log.push(['scrollIntoView', id]), classList: { add: c => log.push(['classList.add', id, c]) } }) },
  requestAnimationFrame: fn => fn(),
  goToTab: t => log.push(['goToTab', t]),
  openPreListingDetail: id => log.push(['openPreListingDetail', id]),
  openTransactionDetail: id => log.push(['openTransactionDetail', id]),
  openConversation: (...a) => log.push(['openConversation', ...a]),
  toast: m => log.push(['toast', m]),
  apiGet: async url => ({ conversations: [{ id: 3, other_name: 'Sam', other_user_id: 9 }] }),
  console,
};
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.__t = { parseAppLink, openAppLink, openNotification };', sandbox);
const { parseAppLink, openNotification } = sandbox.__t;

let failed = 0;
function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
}

(async () => {
  expect('parse pre-listing', parseAppLink('/app#pre-listing-12'), { kind: 'pre-listing', id: 12 });
  expect('parse transaction', parseAppLink('/app#transaction-7'), { kind: 'transaction', id: 7 });
  expect('parse agent', parseAppLink('/app#agent-42'), { kind: 'agent', id: 42 });
  expect('parse messages', parseAppLink('/app#messages-3'), { kind: 'messages', id: 3 });
  expect('parse plain /app', parseAppLink('/app'), null);
  expect('parse "/"', parseAppLink('/'), null);
  expect('parse null', parseAppLink(null), null);
  expect('parse junk hash', parseAppLink('/app#pre-listing-abc'), null);
  expect('parse injected suffix', parseAppLink('/app#pre-listing-12"><img>'), null);

  const run = async (type, link) => { log.length = 0; await openNotification(type, link); return log.slice(); };
  const closePanel = ['classList.add', 'notifPanel', 'hidden'];
  expect('pre-listing notification', await run('marketplace', '/app#pre-listing-12'), [closePanel, ['goToTab', 'marketplace'], ['openPreListingDetail', 12]]);
  expect('transaction notification', await run('marketplace', '/app#transaction-7'), [closePanel, ['goToTab', 'marketplace'], ['openTransactionDetail', 7]]);
  expect('agent notification', await run('marketplace', '/app#agent-42'), [closePanel, ['navigate', 'profile.html?id=42']]);
  expect('message notification (found)', await run('message', '/app#messages-3'), [closePanel, ['goToTab', 'messages'], ['openConversation', 3, 'Sam', 9]]);
  expect('message notification (gone)', await run('message', '/app#messages-99'), [closePanel, ['goToTab', 'messages'], ['toast', 'That conversation is no longer available.']]);
  expect('match notification', await run('match', '/app'), [closePanel, ['goToTab', 'matches']]);
  expect('like notification', await run('like', '/app'), [closePanel, ['goToTab', 'feed']]);
  expect('comment notification', await run('comment', '/app'), [closePanel, ['goToTab', 'feed']]);
  expect('saved-search notification', await run('saved_search', '/'), [closePanel, ['navigate', '/']]);
  expect('#post-home lands on the Agents tab and opens the post-your-home form', await run('marketplace', '/app#post-home'), [closePanel, ['goToTab', 'marketplace'], ['open', 'postHomeWrap', true], ['scrollIntoView', 'postHomeWrap']]);
  expect('#become-agent opens the agent application', await run('marketplace', '/app#become-agent'), [closePanel, ['goToTab', 'marketplace'], ['open', 'becomeAgentWrap', true], ['scrollIntoView', 'becomeAgentWrap']]);
  expect('no link at all', await run('marketplace', ''), [closePanel]);

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
