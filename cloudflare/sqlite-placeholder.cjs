// Cloudflare uses the injected Durable Object SQL adapter instead of node:sqlite.
exports.DatabaseSync=class{constructor(){throw Error('Durable Object database adapter required')}};
