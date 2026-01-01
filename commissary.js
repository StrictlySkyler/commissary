const name = 'commissary';
const pkgs = [
  'js-htmlencode',
  'git+https://github.com/strictlyskyler/google-sheets-api',
];
let encode;
let Shipments;
let Sheets;
const range = 'A:A';

process.env.SUPPRESS_SHEETS_LOGS = process.env.SUPPRESS_SHEETS_LOGS != undefined
  ? process.env.SUPPRESS_SHEETS_LOGS
  : true;

const render_input = (values) => {
  return `
    <p>Google Sheet Config:</p>
    <label>Sheet ID
      <input
        type=text
        required
        name="sheet_id"
        placeholder="<your sheet ID here>"
        value=${(values && encode(values.sheet_id)) || ''}>
    </label>
    <label>Sheet Title
      <input
        type=text
        name="sheet_title"
        placeholder="(defaults to first sheet)"
        value=${(values && values.sheet_title) || ''}>
    </label>
    <label>Base64 encoded string of JSON credentials
      <textarea
        required
        name="creds">${(values && encode(values.creds)) || ''}</textarea>
    </label>
  `;
};

const load_sheet = async (manifest) => {
  if (!manifest || !manifest.sheet_id) return { title: '(none yet)' };

  try {
    const creds = JSON.parse(Buffer.from(manifest.creds, 'base64').toString());
    const sheets = new Sheets({
      email: creds.client_email,
      key: creds.private_key,
    });
    const max_retries = 4;
    const base_delay_ms = 300;
    const doc = await retry(
      () => sheets.getSheets(manifest.sheet_id),
      max_retries,
      base_delay_ms,
    );
    let subsheet_id;
    if (manifest.sheet_title) {
      const subsheet = doc.find((s) => s.title == manifest.sheet_title);
      const sheet_title = manifest.sheet_title;
      if (!subsheet) throw new Error(`Sheet title not found: ${sheet_title}`);
      subsheet_id = subsheet.id;
    }
    else subsheet_id = doc[0].id;
    const result = await retry(
      () => sheets.getRange(manifest.sheet_id, subsheet_id, range),
      max_retries,
      base_delay_ms,
    );
    return result;
  }
  catch (e) {
    console.log(e);
    return { title: 'Invalid!' };
  }
};

const retry_re = /(timeout|timed out|thrott|rate limit|quota|exceeded)/i;

const retry = async (fn, max_retries = 3, base_delay_ms = 250) => {
  const max_delay_ms = 5000;
  const is_transient = (err) => {
    const code = err && err.code;
    const status = err && (
      err.status ||
      err.statusCode ||
      (err.response && err.response.status)
    );
    if (status === 408 || status === 429) return true;
    if (typeof status === 'number' && status >= 500) return true;
    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return true;
    if (code === 'ECONNRESET' || code === 'EAI_AGAIN') return true;
    const msg = err && err.message;
    return typeof msg === 'string' && retry_re.test(msg);
  };

  for (let attempt = 0; attempt <= max_retries; attempt++) {
    try {
      return await fn();
    }
    catch (err) {
      const is_last = attempt === max_retries;
      /* istanbul ignore next */
      if (!H.isTest) console.error(err);
      if (is_last || !is_transient(err)) throw err;

      const exp_delay_ms = Math.min(
        max_delay_ms,
        base_delay_ms * (2 ** attempt),
      );
      const jitter_ms = Math.floor(Math.random() * 150);
      const delay_ms = exp_delay_ms + jitter_ms;
      await new Promise((resolve) => setTimeout(resolve, delay_ms));
    }
  }
  throw new Error('Retry attempts exhausted');
};

const render_work_preview = async (manifest) => {
  let sheet = await load_sheet(manifest);
  let list = ['(Loading...)'];
  if (sheet.length) { list = sheet; }

  return `
    <p>At random, pick dinner from this list: ${list.join(', ')}</p>
  `;
};

const update = async (lane, values) => {
  if (!values.sheet_id || !values.creds) return false;
  try {
    await load_sheet(values);
    return true;
  }
  catch (e) {
    console.error(e);
    return false;
  }
};

const work = (lane, manifest) => {
  pick_meal(manifest, lane).catch((err) => {
    /* istanbul ignore next */
    if (!H.isTest) console.error(err);
  });
  return manifest;
};

const pick_meal = async (manifest, lane) => {
  const sheet = await load_sheet(manifest);
  const index = Math.floor(Math.random() * sheet.length);
  const result = sheet[index] && sheet[index][0];
  return await done(manifest, lane, result);
};

const done = H.bind(async (manifest, lane, result) => {
  const key = new Date().toISOString().replace(/\./g, '_');
  const exit_code = 0;
  const shipment_id = manifest.shipment_id;
  const rendered = typeof result === 'string' ? result : JSON.stringify(result);

  manifest.result = rendered;
  await Shipments.updateAsync(
    { _id: shipment_id },
    { $set: { [`stdout.${key}`]: rendered } },
  );
  return await H.end_shipment(lane, exit_code, manifest);
});

module.exports = {
  next: () => {
    try {
      Sheets = require('google-sheets-api').Sheets;
      encode = require('js-htmlencode').htmlEncode;
    }
    catch (e) {
      console.error('Unable to load dependency!');
      console.error(e);
      process.exit(2);
    }
  },
  register: (_lanes, _users, _harbors, shipments) => {
    Shipments = shipments;
    return { name, pkgs };
  },
  render_input,
  render_work_preview,
  update,
  work,
};

