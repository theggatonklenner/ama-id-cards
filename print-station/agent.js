'use strict';
/*
 * AMA ID Cards print station
 * Runs on the Windows laptop connected to the PPC ID 4000.
 * Watches for approved print jobs and prints them without any dialogs.
 *
 *   node agent.js                  start the print station
 *   node agent.js --list-printers  show printer names (to fill in config.json)
 *   node agent.js --test           sign in, check the printer, then exit
 *   node agent.js --mark-offline   tell the website the print station has stopped
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const { print, getPrinters } = require('pdf-to-printer');

const BUCKET = 'cards';
const HEARTBEAT_MS = 15 * 1000;   // the website shows offline about 45 seconds after check-ins stop
const POLL_MS = 20 * 1000;
const LOG_FILE = path.join(__dirname, 'agent.log');
const CONFIG_FILE = path.join(__dirname, 'config.json');

/* ---------- Logging ---------- */
function log(...parts) {
  const line = `[${new Date().toLocaleString('en-AU')}] ${parts.join(' ')}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    }
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* logging must never stop printing */ }
}
const errText = e => (e && (e.message || e.error_description || e.error)) || String(e);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Config ---------- */
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error('config.json is missing. Copy config.example.json to config.json and fill it in.');
  }
  const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  for (const key of ['supabaseUrl', 'supabaseAnonKey', 'email', 'password', 'printer']) {
    if (!c[key] || /YOUR-|your-email|the password/.test(String(c[key]))) throw new Error(`config.json: "${key}" still needs filling in.`);
  }
  c.duplexSide = c.duplexSide || 'duplexlong';
  c.scale = c.scale || 'noscale';
  return c;
}

async function listPrinters() {
  const printers = await getPrinters();
  console.log('Printers on this computer:');
  for (const p of printers) console.log('  ' + p.name);
  return printers;
}

/* ---------- Print station ---------- */
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list-printers')) { await listPrinters(); return; }

  const config = loadConfig();
  const sb = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: true }
  });

  async function signIn() {
    for (let attempt = 1; ; attempt++) {
      const { error } = await sb.auth.signInWithPassword({ email: config.email, password: config.password });
      if (!error) { log('Signed in as', config.email); return; }
      log(`Sign in failed (attempt ${attempt}): ${errText(error)}`);
      if (/invalid login/i.test(errText(error))) throw new Error('The email or password in config.json is wrong.');
      await sleep(Math.min(30000 * attempt, 300000));
    }
  }
  await signIn();

  // Check the printer exists
  try {
    const printers = await getPrinters();
    if (!printers.some(p => p.name === config.printer)) {
      log(`WARNING: printer "${config.printer}" was not found. Printers found: ${printers.map(p => p.name).join(', ') || 'none'}`);
    } else {
      log(`Printer found: ${config.printer}`);
    }
  } catch (e) { log('Could not list printers:', errText(e)); }

  if (args.includes('--test')) { log('Test finished. Everything needed to print is set up.'); return; }

  async function markOffline() {
    await sb.from('print_station').upsert({ id: 1, last_seen: null, printer_name: config.printer, computer: os.hostname() });
  }
  if (args.includes('--mark-offline')) { await markOffline(); log('Marked the print station as stopped.'); return; }

  // Show offline straight away when closed with Ctrl+C or the window is closed
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(sig, async () => {
      if (stopping) return; stopping = true;
      log('Stopping print station.');
      try { await Promise.race([markOffline(), sleep(3000)]); } catch { /* exiting anyway */ }
      process.exit(0);
    });
  }

  // Heartbeat so phones can see the print station is online
  async function heartbeat() {
    const { error } = await sb.from('print_station').upsert({
      id: 1, last_seen: new Date().toISOString(), printer_name: config.printer, computer: os.hostname()
    });
    if (error) {
      log('Heartbeat failed:', errText(error));
      if (/jwt|token|auth/i.test(errText(error))) { try { await signIn(); } catch (e) { log(errText(e)); } }
    }
  }

  // Any job left "printing" when the station stopped is marked failed so it can be retried
  {
    const { error } = await sb.from('print_jobs')
      .update({ status: 'failed', error: 'The print station restarted while this job was printing. Check the printer, then try again.' })
      .eq('status', 'printing');
    if (error) log('Could not reset stuck jobs:', errText(error));
  }

  async function printJob(job) {
    // Claim the job so it can only ever print once
    const { data: claimed, error: claimError } = await sb.from('print_jobs')
      .update({ status: 'printing', error: null })
      .eq('id', job.id).eq('status', 'approved')
      .select('id');
    if (claimError) { log('Could not claim job:', errText(claimError)); return; }
    if (!claimed || !claimed.length) return;

    const names = (job.people_names || []).join(', ');
    log(`Printing job ${job.id}: ${job.card_count} card(s), ${job.sides} - ${names}`);
    const tmp = path.join(os.tmpdir(), `ama-card-job-${job.id}.pdf`);
    try {
      const { data: blob, error } = await sb.storage.from(BUCKET).download(job.pdf_path);
      if (error) throw new Error('Could not download the cards: ' + errText(error));
      fs.writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));

      await print(tmp, {
        printer: config.printer,
        side: job.sides === 'both' ? config.duplexSide : 'simplex',
        scale: config.scale,
        silent: true
      });

      await sb.from('print_jobs').update({ status: 'printed', printed_at: new Date().toISOString(), error: null }).eq('id', job.id);
      log(`Job ${job.id} sent to the printer.`);
    } catch (e) {
      const msg = errText(e).slice(0, 400);
      log(`Job ${job.id} failed: ${msg}`);
      await sb.from('print_jobs').update({ status: 'failed', error: msg }).eq('id', job.id);
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    }
  }

  let busy = false, again = false;
  async function processQueue() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        const { data: jobs, error } = await sb.from('print_jobs')
          .select('*').eq('status', 'approved').order('created_at', { ascending: true }).limit(10);
        if (error) { log('Could not check for jobs:', errText(error)); break; }
        for (const job of jobs || []) await printJob(job);
      } while (again);
    } catch (e) {
      log('Queue error:', errText(e));
    } finally { busy = false; }
  }

  sb.channel('print-station')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'print_jobs' }, () => processQueue())
    .subscribe(status => log('Live connection:', status));

  await heartbeat();
  await processQueue();
  setInterval(heartbeat, HEARTBEAT_MS);
  setInterval(processQueue, POLL_MS);
  log('Print station running. Waiting for approved jobs.');
}

process.on('unhandledRejection', e => log('Unexpected error:', errText(e)));
const oneShot = ['--test', '--list-printers', '--mark-offline'].some(a => process.argv.includes(a));
main()
  .then(() => { if (oneShot) process.exit(0); })
  .catch(e => { log('Stopped:', errText(e)); process.exit(1); });
