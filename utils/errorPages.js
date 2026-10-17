const fs = require('fs');
const path = require('path');
const { STATUS_CODES } = require('http');
const template = fs.readFileSync(path.join(__dirname, '../public/error.html'), 'utf8');
const messages = {
  400: ['Invalid request', 'The request could not be understood. Check the address or submitted information and try again.'],
  401: ['Sign in to continue', 'Please sign in to access this page.'],
  403: ['Access denied', 'You do not have permission to access this page.'],
  404: ['Page not found', 'This page may have moved, or the address may be incorrect.'],
  405: ['Method not allowed', 'This page does not support that request method.'],
  413: ['Request too large', 'The submitted content exceeds the allowed size. Try a smaller request.'],
  429: ['Too many requests', 'Please wait a moment before trying again.'],
  500: ['Something went wrong', 'The server could not complete your request. Please try again shortly.'],
  502: ['Upstream service unavailable', 'A connected service returned an invalid response. Please try again shortly.'],
  503: ['Temporarily unavailable', 'The server is restarting or busy. Please try again shortly.'],
  504: ['Request timed out', 'A connected service took too long to respond. Please try again shortly.'],
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function createErrorPages(mountPath = '') {
  const base = mountPath.replace(/\/$/, '');
  function wantsHtml(req) {
    let pathname = req.path;
    if (base && pathname.startsWith(base + '/')) pathname = pathname.slice(base.length);
    // API/auth clients must never receive HTML in place of their JSON contract.
    return !/^\/(api|auth)(\/|$)/.test(pathname) && req.accepts(['html', 'json']) === 'html';
  }
  function send(req, res, status) {
    status = Number(status);
    if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
    const [title, message] = messages[status] || [STATUS_CODES[status] || 'Request failed', 'The server could not complete this request. Please try again.'];
    res.status(status).set('Cache-Control', 'no-store');
    if (!wantsHtml(req)) return res.json({ success: false, error: status === 404 ? 'NOT_FOUND' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message });
    const values = { BASE: base, STATUS: status, TITLE: title, MESSAGE: message };
    return res.type('html').send(template.replace(/\{\{(BASE|STATUS|TITLE|MESSAGE)\}\}/g, (_, key) => escape(values[key])));
  }
  function middleware(req, res, next) {
    const json = res.json;
    res.json = function (body) {
      if (res.statusCode >= 400 && wantsHtml(req)) return send(req, res, res.statusCode);
      return json.call(this, body);
    };
    next();
  }
  function notFound(req, res) { return send(req, res, 404); }
  function onError(error, req, res, next) {
    if (res.headersSent) return next(error);
    const status = error.status || error.statusCode || 500;
    console.error('[http] request failed', { status, name: error.name });
    return send(req, res, status);
  }
  return { middleware, notFound, onError, send };
}
module.exports = { createErrorPages };
