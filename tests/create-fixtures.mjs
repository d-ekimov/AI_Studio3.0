// Synthetic, non-private files for manual end-to-end verification. No API calls.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync, zlibSync, strToU8 } from "fflate";
const out = resolve(import.meta.dirname, "../test-results/fixtures");
mkdirSync(out, { recursive: true });
const save = (name, data) => writeFileSync(resolve(out, name), data);
const zip = entries => zipSync(Object.fromEntries(Object.entries(entries).map(([name, xml]) => [name, strToU8(xml)])));
const rels = target => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`;
const contentTypes = overrides => `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
save("analysis.docx", zip({
  "[Content_Types].xml": contentTypes('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
  "_rels/.rels": rels("word/document.xml"),
  "word/document.xml": '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Document code ORION-742. Item A: 17. Item B: 25. Total: 42.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
}));
save("analysis.xlsx", zip({
  "[Content_Types].xml": contentTypes('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),
  "_rels/.rels": rels("xl/workbook.xml"),
  "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ORION-742</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Item A</t></is></c><c r="B2"><v>17</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Item B</t></is></c><c r="B3"><v>25</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Total</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>42</v></c></row></sheetData></worksheet>',
}));
const stream = 'BT /F1 14 Tf 40 750 Td (Document code ORION-742. Item A: 17. Item B: 25. Total: 42.) Tj ET';
const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
let pdf = "%PDF-1.4\n"; const offsets = [0];
objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i+1} 0 obj\n${obj}\nendobj\n`; });
const start = pdf.length;
pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10,"0")+' 00000 n \n').join("") + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
save("analysis.pdf", pdf);
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, checksum]);
}
const width=400, height=200, raw=Buffer.alloc((width*3+1)*height,255);
for(let y=0;y<height;y++) { raw[y*(width*3+1)]=0; for(let x=0;x<width;x++) {
  const color=x>=40&&x<140&&y>=50&&y<150?[230,30,30]:(x-300)**2+(y-100)**2<=2500?[255,220,0]:[255,255,255];
  raw.set(color,y*(width*3+1)+1+x*3);
} }
const header=Buffer.alloc(13); header.writeUInt32BE(width,0); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
save("shapes.png", Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",Buffer.from(zlibSync(raw))),chunk("IEND",Buffer.alloc(0))]));
save("unsupported.exe", "Synthetic unsupported file; not an executable.");
console.log(out);
