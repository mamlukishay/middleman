// serve.sh is the playbook, so what it prints and what it binds are the contract.
//
// The bug this guards: it used to bind 127.0.0.1 and print only a localhost URL, which
// is the one address a phone can never reach -- and the share panel, with nowhere to
// send the phone, drew a warning instead of a QR. The default is now every interface,
// and the banner has to name the LAN address the phone types.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SH = join(ROOT, 'serve.sh');

/** The Wi-Fi address, the way serve.sh finds it. Empty off a network, and then the
 *  address assertions have nothing to assert and are skipped. */
function lanIp() {
  for (const dev of ['en0', 'en1']) {
    try {
      const ip = execFileSync('ipconfig', ['getifaddr', dev], { encoding: 'utf8' }).trim();
      if (ip) return ip;
    } catch { /* no such interface, or it is down */ }
  }
  return '';
}

/** Run serve.sh long enough to read its banner and ask the server what it bound. */
async function run(args, port) {
  const p = spawn('bash', [SH, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  let info = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 150));
    try {
      const r = await fetch(`http://127.0.0.1:${port}/relay/info`);
      if (r.ok) { info = await r.json(); break; }
    } catch { /* not up yet */ }
  }
  p.kill('SIGKILL');
  // strip the bold/dim escapes so the assertions read as the plain words on screen
  return { out: out.replace(/\x1b\[[0-9;]*m/g, ''), info };
}

const ip = lanIp();

test('serve.sh binds every interface and prints the address the phone types', async () => {
  const { out, info } = await run(['8871'], 8871);
  assert.ok(info, 'the server never came up');
  assert.equal(info.bind, '0.0.0.0');
  assert.equal(info.tls, false, 'the mirror path is plain http on purpose');
  assert.match(out, /Middleman is up\./);
  assert.match(out, /http:\/\/localhost:8871/);
  assert.match(out, /Put it on the phone/);
  if (ip) {
    assert.match(out, new RegExp(`http://${ip.replace(/\./g, '\\.')}:8871/learn-m\\.html`),
      'the banner has to name the LAN address, not just localhost');
    assert.ok(info.addrs.includes(ip), '/relay/info hands the share panel the same address');
  }
});

test('serve.sh --local goes back to loopback, and says the phone cannot reach it', async () => {
  const { out, info } = await run(['--local', '8872'], 8872);
  assert.ok(info, 'the server never came up');
  assert.equal(info.bind, '127.0.0.1');
  assert.match(out, /Loopback only/);
  assert.doesNotMatch(out, /learn-m\.html/, 'there is no phone address to offer');
});

test('serve.sh sends the piano-on-the-phone case to phone.sh', async () => {
  const { out } = await run(['8873'], 8873);
  assert.match(out, /phone\.sh/);
  assert.match(out, /https/, 'and says why: Web MIDI on the phone needs a certificate');
});
