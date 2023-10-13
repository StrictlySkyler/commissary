/* eslint no-unused-vars: 0 */
const name = 'commissary';
const pkgs = [
  'js-htmlencode', 'easy-sheets'
];
let EasySheets;
let encode;
let Shipments;

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
    const easy_sheet = new EasySheets(manifest.sheet_id, manifest.creds);
    await easy_sheet.authorize();

    return easy_sheet;
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
  let easy_sheet = await load_sheet(manifest);
  let list = ['(Loading...)'];
  let { sheet_title: sheet } = manifest;
  if (easy_sheet.getRange) list = await easy_sheet.getRange('A:A', { sheet });

  return `
    <p>At random, pick dinner from this list: ${list.join(', ')}</p>
  `;
};

const update = async (lane, values) => {
  if (!values.sheet_id || !values.account || !values.api_key) return false;
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
  let easy_sheet = await load_sheet(manifest);
  let { sheet_title: sheet } = manifest;
  let list = await easy_sheet.getRange('A:A', { sheet });
  let result = list[Math.round(Math.random() * list.length)][0]
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
    EasySheets = require('easy-sheets').default;
    encode = require('js-htmlencode').htmlEncode;
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

