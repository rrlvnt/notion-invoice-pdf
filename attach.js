const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.PAGE_ID;
const pdfUrl = process.env.PDF_URL;

// CONFIRM: change 'PDF' to the exact property name on your invoice database,
// case-sensitive, must be a "Files & media" type property.
const ATTACHMENT_PROPERTY_NAME = 'PDF';

async function main() {
  if (!pdfUrl) {
    throw new Error('No PDF_URL provided — upload step may have failed.');
  }

  await notion.pages.update({
    page_id: pageId,
    properties: {
      [ATTACHMENT_PROPERTY_NAME]: {
        files: [
          {
            type: 'external',
            name: 'invoice.pdf',
            external: { url: pdfUrl }
          }
        ]
      }
    }
  });

  console.log(`Attached PDF to page ${pageId}: ${pdfUrl}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
