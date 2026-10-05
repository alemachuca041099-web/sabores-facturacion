// Manejadores reales de Express sin sockets; simulación con almacenamiento en memoria.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const express = require('express');
let stored;
const simulationContext = { module: { exports: {} }, __dirname: path.resolve('.'), Buffer, console, require(name) {
  if (name === 'fs') return {
    readFileSync() { if (!stored) throw new Error('Sin datos'); return stored; },
    mkdirSync() {}, writeFileSync(file, value) { stored = value; },
  };
  return require(name);
} };
vm.runInNewContext(fs.readFileSync('simulation.js', 'utf8'), simulationContext);
let application;
vm.runInNewContext(fs.readFileSync('server.js', 'utf8'), {
  __dirname: path.resolve('.'), console,
  process: { env: { SIMULATION_MODE: 'true', PANEL_PASSWORD: 'test-password', SESSION_SECRET: 'test-session-secret', PORT: '0' } },
  require(name) {
    if (name === 'dotenv') return { config() {} };
    if (name === './simulation') return simulationContext.module.exports;
    if (name === 'express') {
      const factory = () => {
        const app = express();
        application = app;
        app.listen = () => {};
        return app;
      };
      return Object.assign(factory, express);
    }
    return require(name.startsWith('./') ? path.resolve(name) : name);
  },
});
(async () => {
  const middleware = application.router.stack.find(layer => !layer.route).handle;
  function response() {
    return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, vary() {},
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; },
      redirect(url) { this.statusCode = 302; this.location = url; },
      sendFile(file) { this.body = fs.readFileSync(file, 'utf8'); }, send(value) { this.body = value; } };
  }
  const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';
  const session = { destroy(callback) { delete this.authed; callback(); } };
  async function route(routePath, method, body = {}, params = {}, query = {}) {
    const layer = application.router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method]);
    assert.ok(layer, routePath);
    const req = { body, params, query, session };
    const res = response();
    // El parser de /login no forma parte de esta prueba de manejadores.
    const handlers = layer.route.stack.map(layer => layer.handle).filter(handler => handler.name !== 'urlencodedParser');
    async function invoke(index) {
      if (index < handlers.length) await handlers[index](req, res, () => invoke(index + 1));
    }
    await invoke(0);
    return res;
  }
  for (const ua of ['iPhone Mobile', 'Linux Android 14', 'iPad', 'Windows Phone', 'Opera Mini']) {
    for (const url of ['/login.html', '/', '/index.html', '/app.js', '/login', '/api/invoices']) {
      const res = response();
      let passed = false;
      middleware({ path: url, method: url === '/login' ? 'POST' : 'GET', get: () => ua, session: { authed: true } }, res, () => { passed = true; });
      assert.equal(passed, false);
      assert.equal(res.statusCode, 403);
      if (!url.startsWith('/api/')) {
        assert.match(res.body, /Solo disponible en computadora/);
        assert.doesNotMatch(res.body, /invoice-form|name="password"/);
      }
    }
    let passed = false;
    middleware({ path: '/styles.css', method: 'GET', get: () => ua }, response(), () => { passed = true; });
    assert.equal(passed, true);
  }
  let passed = false;
  middleware({ path: '/', method: 'GET', get: () => desktop }, response(), () => { passed = true; });
  assert.equal(passed, true);
  assert.equal((await route('/login', 'post', { password: 'wrong' })).location, '/login.html?error=1');
  assert.equal((await route('/login', 'post', { password: 'test-password' })).location, '/');
  assert.equal(session.authed, true);
  const customer = (await route('/api/customers', 'post', { legalName: 'Cliente Prueba', taxId: 'XAXX010101000', taxSystem: '616', zip: '76800' })).body;
  assert.ok(customer.id);
  assert.equal((await route('/api/customers', 'get', {}, {}, { q: 'Prueba' })).body.data[0].id, customer.id);
  const invoice = (await route('/api/invoices', 'post', { amount: 116, taxMode: 'incluido', customerId: customer.id })).body;
  assert.equal(invoice.simulated, true);
  assert.equal(invoice.folio_number, 'SIM-0001');
  const pdf = await route('/api/invoices/:id/pdf', 'get', {}, { id: invoice.id });
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await route('/logout', 'post')).location, '/login.html');
  assert.equal((await route('/api/customers', 'get', {}, {}, { q: 'Prueba' })).statusCode, 401);
    for (const [width, ua, expected] of [[767, desktop, true], [768, desktop, false], [1200, 'iPhone', true]]) {
      let blocked;
      const listeners = {};
      const context = { navigator: { userAgent: ua }, document: { documentElement: { classList: { toggle(name, value) { blocked = value; } } }, addEventListener(name, fn) { listeners[name] = fn; } }, window: { matchMedia: () => ({ matches: width < 768 }), addEventListener(name, fn) { listeners[name] = fn; } } };
      vm.runInNewContext(fs.readFileSync('public/device-policy.js', 'utf8'), context);
      assert.equal(blocked, expected);
      let prevented = false;
      listeners.submit({ preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
      assert.equal(prevented, expected);
      context.window.matchMedia = () => ({ matches: true });
      listeners.resize();
      assert.equal(blocked, true);
    }
    console.log('OK: middleware móvil, manejadores login/logout, clientes, factura/PDF y viewport 767/768 + resize. Sin sockets; datos solo en memoria.');
})().catch(error => { console.error(error); process.exitCode = 1; });
