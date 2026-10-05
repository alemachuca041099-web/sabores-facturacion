/* Modo simulación — mismo flujo que Facturama (buscar/crear cliente,
 * generar factura, descargar PDF) pero sin cuenta real: todo se guarda en
 * un archivo local y el PDF se genera aquí mismo, con una marca de agua
 * bien visible de que no es un documento fiscal válido.
 *
 * Las formas que regresa (Id, Name, Rfc, Folio, VerificationUrl...) copian
 * las de facturama.js a propósito, para que server.js no tenga que saber
 * cuál de los dos está usando. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');

// En Vercel el directorio del proyecto es de solo lectura — solo /tmp admite
// escritura (y no persiste entre invocaciones frías, pero al menos no truena
// al guardar). Local sigue usando data/ junto al proyecto, como siempre.
const DATA_DIR = process.env.VERCEL ? path.join(os.tmpdir(), 'sabores-simulation') : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'simulation.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { customers: [], invoices: [], nextFolio: 1 };
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function money(n) {
  return `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderPdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'letter', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const INK = '#0b0a09';
    const MUTED = '#6b6459';
    const GOLD = '#9c7a2f';
    const GOLD_LIGHT = '#c9a24a';
    const IVORY = '#f3ede1';
    const IVORY_MUTED = '#cabfa9';
    const RULE = '#e5ddc8';
    const CARD_BG = '#faf7f0';
    const PAGE_W = 612;

    // Marca de agua — SIEMPRE, en cada página, bien visible. Se dibuja antes
    // que todo lo demás: donde cae bajo una figura opaca (franja del
    // encabezado, tarjeta del cliente, caja del total) queda tapada ahí,
    // pero el centro de la página queda libre y es donde más se nota.
    doc.save();
    doc.rotate(-35, { origin: [306, 420] });
    doc.fontSize(58).fillColor('#e2685c').opacity(0.24);
    doc.text('SIMULACIÓN — NO VÁLIDO FISCALMENTE', 0, 390, { width: 612, align: 'center' });
    doc.restore();
    doc.opacity(1);

    // Encabezado — franja oscura de borde a borde con monograma y folio.
    doc.rect(0, 0, PAGE_W, 104).fill(INK);
    doc.circle(74, 52, 20).fill(GOLD_LIGHT);
    doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('S', 65, 42);

    doc.font('Helvetica-Bold').fontSize(23).fillColor(IVORY).text('SABORES', 108, 30);
    doc.font('Helvetica').fontSize(9).fillColor(IVORY_MUTED).text('Restaurante · San Juan del Río, Querétaro', 108, 58);

    doc.font('Helvetica').fontSize(8).fillColor(IVORY_MUTED).text('FOLIO (SIMULADO)', 0, 28, { width: 562, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(GOLD_LIGHT).text(invoice.Folio, 0, 40, { width: 562, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(IVORY_MUTED).text(new Date(invoice.Date).toLocaleString('es-MX'), 0, 62, { width: 562, align: 'right' });

    doc.rect(0, 100, PAGE_W, 4).fill(GOLD_LIGHT);

    // Receptor — tarjeta con borde en vez de solo líneas sueltas.
    const r = invoice.Receiver;
    let y = 134;
    doc.roundedRect(50, y, 512, 74, 6).fillAndStroke(CARD_BG, RULE);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD).text('FACTURAR A', 66, y + 14);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(r.Name, 66, y + 28);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`RFC ${r.Rfc}  ·  Régimen ${r.FiscalRegime}  ·  CP ${r.TaxZipCode}`, 66, y + 46);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Uso de CFDI: ${r.CfdiUse}`, 66, y + 60);

    // Tabla de conceptos — barra de encabezado con tinte en vez de solo texto.
    y += 74 + 36;
    doc.rect(50, y - 8, 512, 22).fill(CARD_BG);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD);
    doc.text('DESCRIPCIÓN', 62, y - 2);
    doc.text('CANT.', 330, y - 2, { width: 40, align: 'right' });
    doc.text('P. UNITARIO', 380, y - 2, { width: 90, align: 'right' });
    doc.text('IMPORTE', 470, y - 2, { width: 82, align: 'right' });

    const item = invoice.Items[0];
    y += 28;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(item.Description, 62, y, { width: 260 });
    doc.text(item.Quantity, 330, y, { width: 40, align: 'right' });
    doc.text(money(item.UnitPrice), 380, y, { width: 90, align: 'right' });
    doc.text(money(item.Total), 470, y, { width: 82, align: 'right' });

    doc.moveTo(50, y + 24).lineTo(562, y + 24).strokeColor(RULE).stroke();

    // Totales — subtotal/IVA en texto, Total en una caja oscura que destaca.
    const subtotal = Number(item.Subtotal);
    const tax = item.Taxes ? Number(item.Taxes[0].Total) : 0;
    const total = Number(item.Total);

    let ty = y + 40;
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Subtotal', 350, ty, { width: 120, align: 'right' });
    doc.fillColor(INK).text(money(subtotal), 470, ty, { width: 82, align: 'right' });
    ty += 18;
    doc.fillColor(MUTED).text('IVA', 350, ty, { width: 120, align: 'right' });
    doc.fillColor(INK).text(money(tax), 470, ty, { width: 82, align: 'right' });

    ty += 26;
    doc.roundedRect(350, ty - 9, 212, 32, 5).fill(INK);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(IVORY_MUTED).text('TOTAL', 364, ty + 1);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(GOLD_LIGHT).text(money(total), 350, ty - 2, { width: 198, align: 'right' });

    // Pie de página — la aclaración importante, no solo la marca de agua.
    // y=690 (no más abajo): el margen inferior de la página es 50pt sobre
    // carta (792pt), así que un texto de 2 líneas empezando más abajo de
    // ~700 se sale del área útil y PDFKit agrega una segunda hoja en blanco.
    doc.font('Helvetica').fontSize(8).fillColor('#b23a2f').text(
      'Este documento fue generado en modo simulación (panel de pruebas de SABORES). No es un CFDI, no está timbrado ante el SAT ' +
        'y no tiene validez fiscal. Sirve únicamente para probar el flujo del panel antes de conectar la cuenta real de Facturama.',
      50,
      690,
      { width: 512, align: 'center' },
    );

    doc.end();
  });
}

function client() {
  return {
    async searchCustomers(keyword) {
      const data = load();
      const q = keyword.toLowerCase();
      return data.customers.filter((c) => c.Name.toLowerCase().includes(q) || c.Rfc.toLowerCase().includes(q));
    },

    async getCustomer(id) {
      const data = load();
      const customer = data.customers.find((c) => c.Id === id);
      if (!customer) throw new Error('Cliente no encontrado (modo simulación).');
      return customer;
    },

    async createCustomer(payload) {
      const data = load();
      const customer = {
        Id: 'sim-cust-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        Name: payload.Name,
        Rfc: payload.Rfc,
        FiscalRegime: payload.FiscalRegime,
        TaxZipCode: payload.TaxZipCode,
        CfdiUse: payload.CfdiUse,
        Email: payload.Email || '',
        Address: payload.Address || {},
      };
      data.customers.push(customer);
      save(data);
      return customer;
    },

    async createInvoice(payload) {
      const data = load();
      const folio = data.nextFolio++;
      const invoice = {
        Id: 'sim-inv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        Folio: 'SIM-' + String(folio).padStart(4, '0'),
        VerificationUrl: null,
        Date: new Date().toISOString(),
        Receiver: payload.Receiver,
        Items: payload.Items,
        PaymentForm: payload.PaymentForm,
      };
      data.invoices.push(invoice);
      save(data);
      return invoice;
    },

    async emailInvoice() {
      // No-op: el modo simulación nunca envía correos de verdad.
      return null;
    },

    async getInvoicePdf(id) {
      const data = load();
      const invoice = data.invoices.find((i) => i.Id === id);
      if (!invoice) throw new Error('Factura simulada no encontrada — puede que el servidor se haya reiniciado.');
      return renderPdf(invoice);
    },
  };
}

module.exports = { client };
