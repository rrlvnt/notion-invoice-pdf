const { Client } = require('@notionhq/client');
const puppeteer = require('puppeteer');
const fs = require('fs');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.PAGE_ID;

const NOTION_COLORS = {
  gray: '#787774', brown: '#9f6b53', orange: '#d9730d', yellow: '#cb912f',
  green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47'
};

// Render a rich_text array into HTML, preserving bold/italic/color/links per run.
function richText(arr = []) {
  return arr.map(t => {
    let content = (t.plain_text || '').replace(/</g, '&lt;').replace(/\n/g, '<br/>');
    const a = t.annotations || {};
    if (a.code) content = `<code>${content}</code>`;
    if (a.bold) content = `<strong>${content}</strong>`;
    if (a.italic) content = `<em>${content}</em>`;
    if (a.strikethrough) content = `<s>${content}</s>`;
    if (a.color && a.color !== 'default' && NOTION_COLORS[a.color.replace('_background', '')]) {
      content = `<span style="color:${NOTION_COLORS[a.color.replace('_background', '')]}">${content}</span>`;
    }
    if (t.href) content = `<a href="${t.href}">${content}</a>`;
    return content;
  }).join('');
}

// Recursively fetch a block's children, and their children, etc.
async function fetchChildrenRecursive(blockId) {
  let blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    blocks = blocks.concat(res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  for (const block of blocks) {
    if (block.has_children) {
      block.children = await fetchChildrenRecursive(block.id);
    }
  }
  return blocks;
}

// Convert a single block (and its children, if any) to HTML.
function blockToHtml(block) {
  const type = block.type;
  const data = block[type];

  switch (type) {
    case 'heading_1': return `<h1>${richText(data.rich_text)}</h1>`;
    case 'heading_2': return `<h2>${richText(data.rich_text)}</h2>`;
    case 'heading_3': return `<h3>${richText(data.rich_text)}</h3>`;
    case 'paragraph': {
      const text = richText(data.rich_text);
      if (!text) return `<div class="spacer"></div>`;
      const colorStyle = data.color && data.color !== 'default' && NOTION_COLORS[data.color.replace('_background', '')]
        ? ` style="color:${NOTION_COLORS[data.color.replace('_background', '')]}"`
        : '';
      return `<p${colorStyle}>${text}</p>`;
    }
    case 'bulleted_list_item': return `<li>${richText(data.rich_text)}</li>`;
    case 'numbered_list_item': return `<li>${richText(data.rich_text)}</li>`;
    case 'divider': return '<hr/>';
    case 'image': {
      const url = data.type === 'external' ? data.external.url : data.file.url;
      return `<img src="${url}" style="max-width:100%"/>`;
    }
    case 'column_list': {
      const columns = (block.children || []).map(col => {
        const inner = blocksToHtml(col.children || []);
        return `<div class="column">${inner}</div>`;
      }).join('');
      return `<div class="column-list">${columns}</div>`;
    }
    default:
      return '';
  }
}

// Convert an array of blocks to HTML, grouping consecutive list items into <ul>/<ol>.
function blocksToHtml(blocks) {
  let html = '';
  let listBuffer = [];
  let listType = null;

  const flushList = () => {
    if (listBuffer.length) {
      const tag = listType === 'numbered_list_item' ? 'ol' : 'ul';
      html += `<${tag}>${listBuffer.join('')}</${tag}>`;
      listBuffer = [];
      listType = null;
    }
  };

  for (const block of blocks) {
    if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
      if (listType && listType !== block.type) flushList();
      listType = block.type;
      listBuffer.push(blockToHtml(block));
    } else {
      flushList();
      html += blockToHtml(block);
    }
  }
  flushList();
  return html;
}

function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function buildHeaderHtml(properties) {
  const invoiceNumber = properties['Invoice #']?.formula?.string || '';
  const terms = properties['Terms']?.select?.name || '';
  const issued = formatDate(properties['Issued']?.date?.start);
  const due = formatDate(properties['Due']?.formula?.date?.start);
  const amount = formatCurrency(properties['Amount']?.number);

  return `
    <div class="invoice-header">
      <div class="invoice-title">INVOICE</div>
      <div class="meta-grid">
        <div class="meta-item"><div class="label">Invoice #</div><div class="value">${invoiceNumber}</div></div>
        <div class="meta-item"><div class="label">Terms</div><div class="value">${terms}</div></div>
        <div class="meta-item"><div class="label">Issued</div><div class="value">${issued}</div></div>
        <div class="meta-item"><div class="label">Due</div><div class="value">${due}</div></div>
      </div>
      <div class="amount-box">
        <div class="label">Amount</div>
        <div class="amount">${amount}</div>
      </div>
    </div>
  `;
}

const CSS = `
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #222;
    font-size: 14px;
    line-height: 1.4;
  }
  .invoice-title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 1px;
    margin-bottom: 20px;
  }
  .meta-grid {
    display: flex;
    gap: 32px;
    margin-bottom: 20px;
  }
  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
    margin-bottom: 2px;
  }
  .value { font-size: 14px; }
  .amount-box { margin-bottom: 24px; }
  .amount { font-size: 24px; font-weight: 700; }
  .column-list {
    display: flex;
    gap: 40px;
    margin: 8px 0;
  }
  .column { flex: 1; }
  p { margin: 0 0 6px 0; }
  .spacer { height: 10px; }
  h1, h2, h3 { margin: 20px 0 8px 0; }
  hr {
    margin: 20px 0;
    border: none;
    border-top: 1px solid #ddd;
  }
  strong {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #888;
    margin-top: 16px;
    margin-bottom: 4px;
  }
  ul, ol { margin: 0 0 8px 20px; padding: 0; }
`;

async function main() {
  const notionPage = await notion.pages.retrieve({ page_id: pageId });
  const headerHtml = buildHeaderHtml(notionPage.properties);

  const blocks = await fetchChildrenRecursive(pageId);
  const bodyHtml = blocksToHtml(blocks);

  const html = `
    <html>
      <head>
        <meta charset="utf-8">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
        <style>${CSS}</style>
      </head>
      <body>
        ${headerHtml}
        ${bodyHtml}
      </body>
    </html>
  `;

  fs.writeFileSync('invoice.html', html);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const browserPage = await browser.newPage();
  await browserPage.setContent(html, { waitUntil: 'networkidle0' });
  await browserPage.evaluateHandle('document.fonts.ready');
  await browserPage.pdf({
    path: 'invoice.pdf',
    format: 'A4',
    landscape: false,
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' }
  });
  await browser.close();

  console.log('PDF generated: invoice.pdf');
}

main().catch(err => { console.error(err); process.exit(1); });
