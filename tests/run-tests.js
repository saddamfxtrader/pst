#!/usr/bin/env node
/**
 * tests/run-tests.js
 * PEPE Smart Trader — Dependency-free test suite.
 *
 * Usage:
 *   node tests/run-tests.js
 *
 * Nothing external required. Node.js 14+ (BigInt support).
 *
 * Tests are extracted directly from ../index.html at runtime to guarantee
 * we are testing the SHIPPED code, not a stale copy.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

/* ──────────────────────────────────────────────────────────
 * 1. Read & extract source
 * ────────────────────────────────────────────────────────── */
const htmlPath = path.join(__dirname, '..', 'index.html');
if(!fs.existsSync(htmlPath)){
  console.error('❌ index.html not found at ' + htmlPath);
  process.exit(1);
}
const HTML = fs.readFileSync(htmlPath, 'utf8');
const scriptMatch = HTML.match(/<script>([\s\S]*?)<\/script>/);
if(!scriptMatch){
  console.error('❌ <script> block not found in index.html');
  process.exit(1);
}
const SCRIPT = scriptMatch[1];

/* Balanced brace / bracket scanner — skips strings & comments */
function sliceBalanced(src, startIdx, openChar, closeChar){
  let depth = 0, i = startIdx, found = false;
  while(i < src.length){
    const c = src[i];
    if(c === '/' && src[i+1] === '/'){ while(i < src.length && src[i] !== '\n') i++; continue; }
    if(c === '/' && src[i+1] === '*'){ i += 2; while(i < src.length - 1 && !(src[i] === '*' && src[i+1] === '/')) i++; i++; continue; }
    if(c === '"' || c === "'" || c === '`'){
      const q = c; i++;
      while(i < src.length){
        if(src[i] === '\\') i += 2;
        else if(src[i] === q) break;
        else i++;
      }
      i++; continue;
    }
    if(c === openChar){ depth++; found = true; }
    else if(c === closeChar){
      depth--;
      if(found && depth === 0) return src.slice(startIdx, i + 1);
    }
    i++;
  }
  throw new Error('Unbalanced ' + openChar + ' at index ' + startIdx);
}

function extractFunction(name){
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('function\\s+' + safe + '\\s*\\(', 'g');
  const m = re.exec(SCRIPT);
  if(!m) throw new Error('function ' + name + ' not found');
  const braceIdx = SCRIPT.indexOf('{', m.index);
  return SCRIPT.slice(m.index, braceIdx) + sliceBalanced(SCRIPT, braceIdx, '{', '}');
}
function extractVarValue(name){
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:const|let)\\s+' + safe + '\\s*=\\s*([^;]+);');
  const m = re.exec(SCRIPT);
  if(!m) throw new Error('var ' + name + ' not found');
  return m[1];
}
function extractObjectLiteral(name){
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:const|let)\\s+' + safe + '\\s*=\\s*\\{');
  const m = re.exec(SCRIPT);
  if(!m) throw new Error('object ' + name + ' not found');
  const braceIdx = SCRIPT.indexOf('{', m.index);
  return sliceBalanced(SCRIPT, braceIdx, '{', '}');
}

/* ──────────────────────────────────────────────────────────
 * 2. Build the test sandbox module
 *    (DOM & storage dependencies are mocked as no-ops)
 * ────────────────────────────────────────────────────────── */
const SANDBOX_CODE = `
  let session = null;
  let settings = { maxInv: 0, maxBuys: 0, feePct: 0 };
  const market = { price: null, status: 'init', ts: 0 };
  function toast(){}
  function persist(){}
  function renderAll(){}
  function syncConversationAfterOrderAction(){}

  ${extractFunction('_sciToPlain')}
  ${extractFunction('dp')}
  ${extractFunction('fmtScaled')}
  const MAX_EXP = ${extractVarValue('MAX_EXP')};
  const D = ${extractObjectLiteral('D')};

  ${extractFunction('n')}
  ${extractFunction('fmtU')}
  ${extractFunction('fmtQ')}
  ${extractFunction('fmtQFull')}
  ${extractFunction('fmtPct')}
  ${extractFunction('formatShortPrice')}
  ${extractFunction('fmtP')}

  ${extractFunction('_roundDecimal')}
  ${extractFunction('roundPrice')}
  ${extractFunction('ceilPrice')}
  ${extractFunction('floorQty')}
  ${extractFunction('parsePEPEPrice')}
  ${extractFunction('parseUSDT')}

  ${extractFunction('getPlanTargetPct')}
  ${extractFunction('getActiveExitTargetPct')}
  ${extractFunction('getActiveExitMode')}
  ${extractFunction('getActiveExitKind')}
  ${extractFunction('calculateExitTarget')}
    ${extractFunction('orderConvertLoss')}
  ${extractFunction('computePosition')}
  ${extractFunction('fillOrder')}
  ${extractFunction('cancelOrder')}

  return {
    setSession: (s) => { session = s; },
    getSession: () => session,
    setSettings: (s) => { settings = s; },
    getSettings: () => settings,
    setMarket: (m) => { Object.assign(market, m); },
    market,
    dp, D, MAX_EXP,
    n, fmtU, fmtQ, fmtQFull, fmtPct, formatShortPrice, fmtP,
    _roundDecimal, roundPrice, ceilPrice, floorQty,
    parsePEPEPrice, parseUSDT,
    getPlanTargetPct, getActiveExitTargetPct, getActiveExitMode, getActiveExitKind,
    calculateExitTarget, computePosition,
    fillOrder, cancelOrder,
    _sciToPlain
  };
`;

let mod;
try {
  mod = new Function(SANDBOX_CODE)();
} catch(e){
  console.error('❌ Failed to construct test module from index.html:');
  console.error('   ' + e.message);
  process.exit(1);
}

/* ──────────────────────────────────────────────────────────
 * 3. Test runner
 * ────────────────────────────────────────────────────────── */
let passed = 0, failed = 0;
const failures = [];

function test(name, fn){
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch(e){
    failed++;
    failures.push({ name, err: e });
    console.log('  ❌ ' + name);
    console.log('     → ' + e.message);
  }
}
function eq(actual, expected, label){
  assert.strictEqual(actual, expected,
    (label ? label + ': ' : '') +
    'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function ok(cond, label){
  assert.ok(cond, label || 'assertion failed');
}

console.log('\n══════════════════════════════════════════════════');
console.log('   PEPE Smart Trader — Automated Test Suite');
console.log('══════════════════════════════════════════════════\n');

/* ═════════════════════════════════════════════════════
 * A. DECIMAL ENGINE (Issue B, C)
 * ═════════════════════════════════════════════════════ */
console.log('A. Decimal Engine — Negative Zero & Sci-Notation');

test('dp("-0") normalizes to zero', () => {
  eq(mod.dp('-0').i, '0', 'dp(-0).i');
  eq(mod.dp('-0.0').i, '0', 'dp(-0.0).i');
  eq(mod.dp('-0.000').i, '0', 'dp(-0.000).i');
  eq(mod.dp('-0').f, '', 'dp(-0).f');
  eq(mod.dp('-0').d, 0, 'dp(-0).d');
});

test('dp("0.0"/"0.000") stays zero', () => {
  eq(mod.dp('0.0').i, '0');
  eq(mod.dp('0.000').i, '0');
  eq(mod.dp('0.000').f, '');
});

test('dp handles empty / null / undefined', () => {
  eq(mod.dp('').i, '0');
  eq(mod.dp('.').i, '0');
  eq(mod.dp(null).i, '0');
  eq(mod.dp(undefined).i, '0');
});

test('D.div by zero (and -0, 0.0) → "0" (no throw)', () => {
  eq(mod.D.div('1', '0'), '0');
  eq(mod.D.div('5', '-0'), '0');
  eq(mod.D.div('1', '0.0'), '0');
  eq(mod.D.div('1', '-0.000'), '0');
});

test('D.mul / D.add with -0 → 0', () => {
  eq(mod.D.mul('-0', '5'), '0');
  eq(mod.D.mul('5', '-0'), '0');
  eq(mod.D.add('-0', '0'), '0');
  eq(mod.D.add('-0', '-0'), '0');
  eq(mod.D.add('-0', '5'), '5');
});

test('D.cmp with -0 vs 0', () => {
  eq(mod.D.cmp('-0', '0'), 0);
  eq(mod.D.cmp('-0.0', '0.000'), 0);
  eq(mod.D.cmp('-0.0', '1'), -1);
});

test('D basic arithmetic (exact)', () => {
  eq(mod.D.add('0.1', '0.2'), '0.3');   // Number would give 0.30000000000000004
  eq(mod.D.mul('3.600', '0.999'), '3.5964');
  eq(mod.D.sub('5', '0.1'), '4.9');
  eq(mod.D.div('1', '3', 10), '0.3333333333');
});

test('_sciToPlain converts scientific notation', () => {
  eq(mod._sciToPlain('3.441e-6'), '0.000003441');
  eq(mod._sciToPlain('1e-7'), '0.0000001');
  eq(mod._sciToPlain('1.5e2'), '150');
  eq(mod._sciToPlain('-2.5e-3'), '-0.0025');
  eq(mod._sciToPlain('2e0'), '2');
});

test('dp accepts sci-notation without precision loss', () => {
  const r = mod.dp('3.441e-6');
  eq(r.i, '0');
  eq(r.f, '000003441');
  eq(r.d, 9);
});

/* ═════════════════════════════════════════════════════
 * C. ROUNDING (Issue C)
 * ═════════════════════════════════════════════════════ */
console.log('\nC. Rounding Precision (String+BigInt)');

test('roundPrice — 9 decimals, half-up', () => {
  eq(mod.roundPrice('0.0000034415'), '0.000003442');
  eq(mod.roundPrice('0.0000034414'), '0.000003441');
  eq(mod.roundPrice('0.0000034410'), '0.000003441');
  eq(mod.roundPrice('1.9999999995'), '2');
  eq(mod.roundPrice('0.1'), '0.1');
});

test('ceilPrice — 9 decimals', () => {
  eq(mod.ceilPrice('0.0000034401'), '0.000003441');
  eq(mod.ceilPrice('0.0000034410'), '0.000003441');
  eq(mod.ceilPrice('0.0000034411'), '0.000003442');
  eq(mod.ceilPrice('1.0000000001'), '1.000000001');
});

test('floorQty — 8 decimals', () => {
  eq(mod.floorQty('6000000.123456789'), '6000000.12345678');
  eq(mod.floorQty('6000000.123456788'), '6000000.12345678');
  eq(mod.floorQty('100'), '100');
  eq(mod.floorQty('0.999999999'), '0.99999999');
});

test('Rounding handles -0', () => {
  eq(mod.roundPrice('-0'), '0');
  eq(mod.roundPrice('-0.0000000000'), '0');
  eq(mod.ceilPrice('-0'), '0');
  eq(mod.floorQty('-0'), '0');
});

test('Rounding via BigInt — no floating-point drift', () => {
  // classic Float trap: 0.1 + 0.2
  eq(mod.roundPrice('0.30000000000000004'), '0.3');
  // 8-decimal floor
  eq(mod.floorQty('1.100000009'), '1.10000000');
});

/* ═════════════════════════════════════════════════════
 * PARSING
 * ═════════════════════════════════════════════════════ */
console.log('\nInput Parsing');

test('parsePEPEPrice accepts valid decimal & sci-notation', () => {
  eq(mod.parsePEPEPrice('0.000003441'), '0.000003441');
  eq(mod.parsePEPEPrice('3.441e-6'), '0.000003441');
  eq(mod.parsePEPEPrice('0.5'), '0.5');
});

test('parsePEPEPrice rejects invalid / out-of-range', () => {
  eq(mod.parsePEPEPrice('abc'), null, 'abc');
  eq(mod.parsePEPEPrice(''), null, 'empty');
  eq(mod.parsePEPEPrice('-0.0001'), null, 'negative');
  eq(mod.parsePEPEPrice('0'), null, 'zero');
  eq(mod.parsePEPEPrice('1.5'), null, '>1');
  eq(mod.parsePEPEPrice('NaN'), null, 'NaN');
});

test('parseUSDT accepts non-negative decimals', () => {
  eq(mod.parseUSDT('5'), '5');
  eq(mod.parseUSDT('5.5'), '5.5');
  eq(mod.parseUSDT('0'), '0');
});

test('parseUSDT rejects invalid values', () => {
  eq(mod.parseUSDT('-1'), null, 'negative');
  eq(mod.parseUSDT('NaN'), null, 'NaN');
  eq(mod.parseUSDT('Infinity'), null, 'Infinity');
  eq(mod.parseUSDT('abc'), null, 'abc');
  eq(mod.parseUSDT(''), null, 'empty');
});

/* ═════════════════════════════════════════════════════
 * E. EXIT TARGET & FEE SNAPSHOT (Issue E)
 * ═════════════════════════════════════════════════════ */
console.log('\nE. Exit Target & Fee Snapshot');

function makeSession(o){
  return Object.assign({
    id: 1, code: 'test',
    planTargetPct: '0', exitTargetPct: '0',
    exitTargetMode: 'gross', exitTargetKind: 'plan', targetPct: '0',
    orders: [], conversation: { state: 'askBuyPrice', data: {} }
  }, o || {});
}
function makeBuy(id, price, qty, usdt){
  return { id, side:'buy', type:'limit', price, usdt, qty,
    status:'filled', filledUsdt:usdt, filledQty:qty, fillPrice:price,
    ts: Date.now(), note:'' };
}
function makeSell(id, price, qty, usdt, feePct){
  return { id, side:'sell', type:'limit', price, usdt, qty,
    status:'filled', filledUsdt:usdt, filledQty:qty, fillPrice:price,
    ts: Date.now(), note:'', feePct };
}

test('Spec scenario: Entry 0.000003441, $5, 1% target, Fee Blank', () => {
  mod.setSession(makeSession({
    planTargetPct:'1', exitTargetPct:'1', exitTargetMode:'gross', targetPct:'1',
    orders: [makeBuy('O1','0.000003441','1453071.78','5')]
  }));
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  mod.setMarket({ price:null });

  const p = mod.computePosition();
  eq(p.targetReturnTotal, '5.05', 'target return');
  eq(p.targetSecured, false, 'not secured');
  ok(Number(p.sellTarget) > 0.000003441, 'sell target must be > entry');
});

test('Fee 0 is same as Fee Blank', () => {
  mod.setSession(makeSession({
    planTargetPct:'1', exitTargetPct:'1', exitTargetMode:'gross', targetPct:'1',
    orders: [makeBuy('O1','0.000003441','1453071.78','5')]
  }));
  mod.setMarket({ price:null });

  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  const a = mod.computePosition();

  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  const b = mod.computePosition();

  eq(a.sellTarget, b.sellTarget);
});

test('Higher fee (Net mode) → higher sell target', () => {
  mod.setSession(makeSession({
    planTargetPct:'1', exitTargetPct:'1', exitTargetMode:'net', targetPct:'1',
    orders: [makeBuy('O1','0.000003441','1453071.78','5')]
  }));
  mod.setMarket({ price:null });

  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0.1 });
  const p01 = mod.computePosition();

  mod.setSettings({ maxInv:0, maxBuys:0, feePct:1 });
  const p1 = mod.computePosition();

  ok(Number(p1.sellTarget) >= Number(p01.sellTarget),
     `fee 1% (${p1.sellTarget}) must be ≥ fee 0.1% (${p01.sellTarget})`);
});

test('Historical net proceeds respect snapshot fee (0.1%)', () => {
  mod.setSession(makeSession({
    planTargetPct:'1', exitTargetPct:'1', exitTargetMode:'net', targetPct:'1',
    orders: [
      makeBuy('O1','0.000003441','1453071.78','5'),
      makeSell('O2','0.000003600','726535.89','2.615529204', 0.1)
    ]
  }));
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:1 }); // current = 1%
  mod.setMarket({ price:null });

  const p = mod.computePosition();
  // 2.615529204 * (1 - 0.001) = 2.612913674796
  ok(p.totalSellNetProceeds.startsWith('2.612913'),
     'historical net must use 0.1% (snapshot), got ' + p.totalSellNetProceeds);
});

/* ═════════════════════════════════════════════════════
 * A. FILL VALIDATION (Issue A)
 * ═════════════════════════════════════════════════════ */
console.log('\nA. Fill Validation');

function pendingBuy(id, price, qty, usdt){
  return { id, side:'buy', type:'limit', price, usdt, qty,
    status:'pending', filledUsdt:'0', filledQty:'0', fillPrice:null,
    ts: Date.now(), note:'' };
}
function pendingSell(id, price, qty, usdt, feePct){
  return { id, side:'sell', type:'limit', price, usdt, qty,
    status:'pending', filledUsdt:'0', filledQty:'0', fillPrice:null,
    ts: Date.now(), note:'', feePct };
}

test('Full fill → status filled', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1453071.78','5')] });
  mod.setSession(s);
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  const r = mod.fillOrder('O1', null, null, true);
  eq(r.ok, true);
  eq(s.orders[0].status, 'filled');
});

test('Fill zero → rejected', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  const r = mod.fillOrder('O1', '0', '0', true);
  eq(r.ok, false);
  ok(r.msg.includes('0-এর বেশি'));
});

test('Fill negative → rejected', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  const r = mod.fillOrder('O1', '-100', '-0.3441', true);
  eq(r.ok, false);
});

test('Fill over remaining qty → rejected', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  const r = mod.fillOrder('O1', '2000000', '6.882', true);
  eq(r.ok, false);
  ok(r.msg.includes('Remaining Qty'));
});

test('Fill over remaining USDT → rejected', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  const r = mod.fillOrder('O1', '500000', '999', true);
  eq(r.ok, false);
  ok(r.msg.includes('Remaining USDT'));
});

test('Partial fill → status partial', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  const r = mod.fillOrder('O1', '400000', '1.3764', true);
  eq(r.ok, true);
  eq(s.orders[0].status, 'partial');
});

test('fillPrice = filledUsdt / filledQty', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  mod.fillOrder('O1', '400000', '1.3764', true);
  eq(mod.roundPrice(s.orders[0].fillPrice), '0.000003441');
});

test('Fill qty only → usdt derived from price', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  const r = mod.fillOrder('O1', '500000', null, true);
  eq(r.ok, true);
  eq(s.orders[0].filledUsdt, '1.7205');
});

test('Sell over holdings → rejected', () => {
  const s = makeSession({
    orders: [
      makeBuy('O1','0.000003441','1000000','3.441'),
      pendingSell('O2','0.000003600','2000000','7.2', 0.1)
    ]
  });
  mod.setSession(s);
  const r = mod.fillOrder('O2', '2000000', '7.2', true);
  eq(r.ok, false);
  ok(r.msg.includes('Holdings'));
});

test('Sell within holdings → OK', () => {
  const s = makeSession({
    orders: [
      makeBuy('O1','0.000003441','1000000','3.441'),
      pendingSell('O2','0.000003600','400000','1.44', 0.1)
    ]
  });
  mod.setSession(s);
  const r = mod.fillOrder('O2', '400000', '1.44', true);
  eq(r.ok, true);
});

/* ═════════════════════════════════════════════════════
 * A2. PARTIAL CANCEL (Issue A2)
 * ═════════════════════════════════════════════════════ */
console.log('\nA2. Partial Cancel — Fills Preserved');

test('Cancel partial order → cancelled_partial, fills kept', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  mod.fillOrder('O1', '400000', '1.3764', true);
  const r = mod.cancelOrder('O1', true);
  eq(r.ok, true);
  eq(s.orders[0].status, 'cancelled_partial');
  eq(s.orders[0].filledQty, '400000');
  eq(s.orders[0].filledUsdt, '1.3764');
});

test('computePosition includes cancelled_partial fills', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  mod.fillOrder('O1', '400000', '1.3764', true);
  mod.cancelOrder('O1', true);

  const p = mod.computePosition();
  eq(p.totalBuyQty, '400000');
  eq(p.totalBuyCost, '1.3764');
  eq(p.remainingQty, '400000');
});

test('Cancel full pending (no fills) → cancelled', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  mod.cancelOrder('O1', true);
  eq(s.orders[0].status, 'cancelled');
});

test('Cannot cancel a fully-filled order', () => {
  const s = makeSession({ orders: [pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  mod.fillOrder('O1', null, null, true);
  const r = mod.cancelOrder('O1', true);
  eq(r.ok, false);
});

/* ═════════════════════════════════════════════════════
 * WEIGHTED AVG & P&L
 * ═════════════════════════════════════════════════════ */
console.log('\nWeighted Avg & P&L');

test('Weighted avg buy from 2 orders', () => {
  const s = makeSession({
    orders: [
      makeBuy('O1','0.000003441','1000000','3.441'),
      makeBuy('O2','0.000003500','1000000','3.500')
    ]
  });
  mod.setSession(s);
  const p = mod.computePosition();
  eq(mod.roundPrice(p.avgBuy), '0.000003471');
});

test('Realized gross (profit case)', () => {
  const s = makeSession({
    orders: [
      makeBuy('O1','0.000003441','1000000','3.441'),
      makeSell('O2','0.000003600','1000000','3.600', 0)
    ]
  });
  mod.setSession(s);
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  const p = mod.computePosition();
  eq(p.remainingQty, '0');
  eq(p.realizedGross, '0.159');
  eq(mod.fmtPct(p.sessionReturnPct), '+4.62%');
});

test('Realized net respects snapshot fee (0.1%)', () => {
  const s = makeSession({
    orders: [
      makeBuy('O1','0.000003441','1000000','3.441'),
      makeSell('O2','0.000003600','1000000','3.600', 0.1)
    ]
  });
  mod.setSession(s);
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:1 });
  const p = mod.computePosition();
  // 3.600 * 0.999 = 3.5964;  3.5964 - 3.441 = 0.1554
  eq(p.realizedNet, '0.1554');
});





/* ═════════════════════════════════════════════════════
 * F. CONVERT LOSS — REAL RECEIVED DATA
 * ═════════════════════════════════════════════════════ */
console.log('\nF. Convert Loss — Real Received Data');

test('Spent 5 / received worth 4.99: cost stays 5, real qty drives sell target', () => {
  const s = makeSession({
    planTargetPct:'1', exitTargetPct:'1', exitTargetMode:'gross', targetPct:'1',
    orders: [pendingBuy('O1','0.000003441','1453065.39','5')]
  });
  mod.setSession(s);
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  mod.setMarket({ price:null });
  const r = mod.fillOrder('O1','1450000','5',true,'4.99');
  eq(r.ok, true);
  eq(s.orders[0].status, 'filled', 'status');
  const p = mod.computePosition();
  eq(p.totalBuyCost, '5', 'cost');
  eq(p.remainingQty, '1450000', 'qty');
  eq(p.totalConvertLoss, '0.01', 'convert loss');
  eq(p.sellTarget, '0.000003483', 'sell target');
  eq(mod.roundPrice(s.orders[0].fillPrice), '0.000003448', 'effective price');
});

test('Two orders: weighted average, sell target and loss', () => {
  const o1 = Object.assign(makeBuy('O1','0.000003441','1450000','5'), { receivedValueUsdt:'4.99', receivedBasisUsdt:'5' });
  const o2 = Object.assign(makeBuy('O2','0.000003500','2300000','8'), { receivedValueUsdt:'7.98', receivedBasisUsdt:'8' });
  mod.setSession(makeSession({
    planTargetPct:'1', exitTargetPct:'1', exitTargetMode:'gross', targetPct:'1',
    orders:[o1, o2]
  }));
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  mod.setMarket({ price:null });
  const p = mod.computePosition();
  eq(p.totalBuyCost, '13');
  eq(p.totalBuyQty, '3750000');
  eq(mod.roundPrice(p.avgBuy), '0.000003467', 'weighted avg');
  eq(p.totalConvertLoss, '0.03', 'total loss');
  eq(p.sellTarget, '0.000003502', 'sell target');
});

test('Old orders without receivedValue: loss is 0, nothing breaks', () => {
  mod.setSession(makeSession({ orders:[makeBuy('O1','0.000003441','1000000','3.441')] }));
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  const p = mod.computePosition();
  eq(p.totalConvertLoss, '0');
});

test('Buy with less USDT than plan stays partial', () => {
  const s = makeSession({ orders:[pendingBuy('O1','0.000003441','1453065.39','5')] });
  mod.setSession(s);
  const r = mod.fillOrder('O1','500000','2',true);
  eq(r.ok, true);
  eq(s.orders[0].status, 'partial');
});

test('Mixed fills: loss counts only fills that had a received value', () => {
  const s = makeSession({ orders:[pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  mod.setSettings({ maxInv:0, maxBuys:0, feePct:0 });
  mod.setMarket({ price:null });
  eq(mod.fillOrder('O1','500000','1.7205',true).ok, true);
  eq(mod.fillOrder('O1','500000','1.7205',true,'1.71').ok, true);
  eq(s.orders[0].status, 'filled');
  eq(mod.computePosition().totalConvertLoss, '0.0105');
});

test('Invalid received value is rejected, order unchanged', () => {
  const s = makeSession({ orders:[pendingBuy('O1','0.000003441','1000000','3.441')] });
  mod.setSession(s);
  const r = mod.fillOrder('O1','500000','1.7205',true,'abc');
  eq(r.ok, false);
  eq(s.orders[0].status, 'pending');
});








/* ═════════════════════════════════════════════════════
 * SUMMARY
 * ═════════════════════════════════════════════════════ */
console.log('\n══════════════════════════════════════════════════');
console.log('   Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('══════════════════════════════════════════════════\n');

if(failed > 0){
  console.log('Failures:');
  for(const f of failures){
    console.log('  • ' + f.name);
    const stack = (f.err && f.err.stack) || String(f.err);
    console.log('    ' + stack.split('\n').slice(0, 3).join('\n    '));
  }
  process.exit(1);
}
process.exit(0);
