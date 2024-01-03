const { first } = require('lodash');

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
  : true
  ;

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
  `
};

const load_sheet = async (manifest) => {
  if (!manifest || !manifest.sheet_id) return { title: '(none yet)' };

  try {
    const creds = JSON.parse(Buffer.from(manifest.creds, 'base64').toString());
    const sheets = new Sheets({
      email: creds.client_email,
      key: creds.private_key,
    });
    const doc = await sheets.getSheets(manifest.sheet_id);
    const sheet1 = await sheets.getSheet(manifest.sheet_id, doc[0].id);
    const result = sheets.getRange(manifest.sheet_id, sheet1.id, range);
    return result;
  }
  catch (e) {
    console.log(e);
    return { title: 'Invalid!' };
  }
};

const retry = async (method, args, count = 0) => {
  let max = 3;
  let result;

  if (count < max) {
    try {
      result = await method(args);
      return result;
    }
    catch (err) {
      console.error(err);
      count = count + 1;
      await retry(method, args, count);
    }
  }
}

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
  } catch (e) {
    console.error(e);
    return false;
  }
};

const work = (lane, manifest) => {
  pick_meal(manifest, lane, done).catch(err => console.error);
  return manifest;
};

const pick_meal = async (manifest, lane, done) => {
  let sheet = await load_sheet(manifest);
  let result = sheet[Math.round(Math.random() * sheet.length)][0];
  done(manifest, lane, result);
};

const done = H.bind((manifest, lane, result) => {
  let key = new Date();
  let exit_code = 0;
  // console.log(result);
  let shipment = Shipments.findOne({ _id: manifest.shipment_id });
  shipment.stdout[key] = result;
  manifest.result = result;
  Shipments.update({ _id: shipment._id }, shipment);
  H.end_shipment(lane, exit_code, manifest);
});

module.exports = {
  next: () => {
    try {
      Sheets = require('google-sheets-api').Sheets;
      encode = require('js-htmlencode').htmlEncode;
    } catch (e) {
      console.error('Unable to load dependency!');
      console.error(e);
      process.exit(2);
    }
  },
  register: (lanes, users, harbors, shipments) => {
    Shipments = shipments;
    return { name, pkgs };
  },
  render_input,
  render_work_preview,
  update,
  work,
};

