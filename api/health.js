export default {
  fetch() {
    return Response.json({ ok: true, service: 'rights-reporter-customer-api', protocolVersion: 1 }, {
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
  }
};

