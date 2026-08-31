const { Client } = require('@notionhq/client');
const puppeteer = require('puppeteer');
const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.PAGE_ID;

// Turn a Notion rich_text array into plain HTML-safe text
function richText(arr = []) {
  return arr.map(t => t.plain_text).join('').replace(/</g, '&lt;');
}

// Minimal block -> HTML converter. Extend as needed for more block types.
function blockToHtml(block) {
  const type = block.type;
  const data = block[type];
  switch (type) {
    case 'heading_1': return `<h1>${richText(data.rich_text)}</h1>`;
    case 'heading_2': return `<h2>${richText(data.rich_text)}</h2>`;
    case 'heading_3': return `<h3>${richText(data.rich_text)}</h3>`;
    case 'paragraph': return `<p>${richText(data.rich_text) || '&nbsp;'}</p>`;
    case 'bulleted_list_item': return `<li>${richText(data.rich_text)}</li>`;
    case 'numbered_list_item': return `<li>${richText(data.rich_text)}</li>`;
    case 'divider': return '<hr/>';
    case 'image': {
      const url = data.type === 'external' ? data.external.url : data.file.url;
      return `<img src="${url}" style="max-width:100%"/>`;
    }
    default: return '';
  }
}

async function getAllBlocks(blockId) {
  let blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor });
    blocks = blocks.concat(res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function main() {
  const blocks = await getAllBlocks(pageId);
  const bodyHtml = blocks.map(blockToHtml).join('\n');

  const html = `
    <html><head><meta charset="utf-8"><style>
      body { font-family: Helvetica, Arial, sans-serif; padding: 40px; color: #222; }
      h1,h2,h3 { margin-top: 1.2em; }
      hr { margin: 24px 0; border: none; border-top: 1px solid #ccc; }
    </style></head><body>${bodyHtml}</body></html>
  `;

  fs.writeFileSync('invoice.html', html);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: 'invoice.pdf', format: 'A4', printBackground: true });
  await browser.close();

  console.log('PDF generated: invoice.pdf');
  // Upload step goes here — see setup notes for options.
}

main().catch(err => { console.error(err); process.exit(1); });
