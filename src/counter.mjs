
/*
function byteStringToUint8Array(byteString) {
  const ui = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; ++i) {
    ui[i] = byteString.charCodeAt(i)
  }
  return ui
}
*/

function hexDigestToUintArray(hexDigest) {
  const nBytes = hexDigest.length / 2;
  const ui = new Uint8Array(nBytes);
  for (let i = 0; i < nBytes; i++) {
    ui[i] = parseInt(hexDigest.substring(i * 2, (i * 2) + 2), 16);
  }
  return ui
}

function compareArrays(a, b) {
  if (a === null || b === null)
    return false;

  if (a.length !== b.length)
    return false;

  const length = a.length;
  for (let i = 0; i < length; i++) {
    if (a[i] != b[i])
      return false;
  }

  return true;
}

export class Counter {
  constructor(state, env) {

    this.encoder = new TextEncoder();
    this.secretKeyData = this.encoder.encode(env.INCREMENT_SIGN_SECRET);

    this.counterResetSecret = env.COUNTER_RESET_SECRET;

    this.maxIncrement = 2000;

    this.historyPos = 0;
    this.history = new Array(10).fill(null);

    this.state = state;
    // `blockConcurrencyWhile()` ensures no requests are delivered until
    // initialization completes.
    this.state.blockConcurrencyWhile(async () => {
        let stored = await this.state.storage.get("value");
        this.value = stored || 0;
    })
  }

  // Handle HTTP requests from clients.
  async fetch(request) {

    let url = new URL(request.url);
    let newValue = this.value;
    switch (url.pathname) {
    case "/increment":

      if (!url.searchParams.has("mac") || !url.searchParams.has("expiry") || !url.searchParams.has("by")) {
        return new Response("Missing query parameter", { status: 403 })
      }

      const key = await crypto.subtle.importKey(
        "raw",
        this.secretKeyData,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      )

      const expiry = parseInt(url.searchParams.get("expiry"));
      if (expiry === NaN || expiry <= 0) {
        const body = "Invalid Expiry"
        return new Response(body, { status: 400 })
      }

      // To add a small additional barrier that makes it awkward to reply requests for sending
      // fake increments we could add a nonce but since the expiry will generally increment
      // every second anyway it's probably not worth it - especially if we have a small amount
      // of history checking to discard replays.
      //const by = parseInt(url.searchParams.get("nonce"));
      //if (by === NaN) {
      //  const body = "Invalid nonce value";
      //  return new Response(body, { status: 400 })
      //}

      const by = parseInt(url.searchParams.get("by"));
      if (by === NaN || by <= 0 || by > this.maxIncrement) {
        const body = "Invalid increment 'by' count";
        return new Response(body, { status: 400 })
      }

      // E.g. string being SHA-256 signed is like "/increment:500:12345678"
      // and then request is made like: https://api.foo.bar/increment?expiry=12345678&by=500&mac=f1a20f01bb
      const dataToAuthenticate = url.pathname + ":" + by + ":" + expiry;

      const receivedMac = hexDigestToUintArray(url.searchParams.get("mac"));

      // Initially I passed the hmac via a base64 string but figured it should be less
      // error prone for clients to send a hex digest (e.g. less chance of bugs with
      // url encoding '+' characters)
      //
      //const receivedMacBase64 = url.searchParams.get("mac")
      //const receivedMac = byteStringToUint8Array(atob(receivedMacBase64))
      //let receivedMac = null;
      //try {
      //  receivedMac = Uint8Array.from(atob(receivedMacBase64), (v) => v.charCodeAt(0));
      //} catch (e) {
      //  const body = "Invalid MAC"
      //  return new Response(body, { status: 403 })
      //}

      // Check for simple replay attempts...
      for (let i = 0; i < this.history.length; i++) {
        if (compareArrays(this.history[i], receivedMac)) {
          const body = "Ignoring duplicate request";
          return new Response(body, { status: 400 })
        }
      }

      const verified = await crypto.subtle.verify(
        "HMAC",
        key,
        receivedMac,
        this.encoder.encode(dataToAuthenticate),
      )

      if (!verified) {
        const body = "Invalid MAC"
        return new Response(body, { status: 403 })
      }

      if (Date.now() > (expiry * 1000)) {
        const body = `URL expired at ${new Date(expiry * 1000)}`
        return new Response(body, { status: 403 })
      }

      newValue = this.value + by;
      this.value = newValue;
      await this.state.storage.put("value", newValue);

      // Simple circular buffer of recent hashes we can check to thwart simple
      // replay attempts...
      this.history[this.historyPos++] = receivedMac;
      this.historyPos %= this.history.length;

      // NB: cloudflare will block the event loop for this worker until
      // this returns (so no other fetch requests will be seen here
      // for this durable object until this is done, so it's safe to
      // trust the state of newValue)
      //
      // (input gate rules)

      break;
    case "/reset":

      if (!url.searchParams.has("secret")) {
        return new Response("Missing query parameter", { status: 403 })
      }

      let secret = url.searchParams.get("secret");
      if (secret !== this.counterResetSecret)
      {
        return new Response("Invalid secret", { status: 403 })
      }

      newValue = 0;
      this.value = 0;
      await this.state.storage.put("value", 0);

      break;
    case "/":
      // Just serve the current value. No storage calls needed!
      break;
    default:
      return new Response("Not found", {status: 404});
    }

    // Return `newValue`. Note that `this.value` may have been
    // incremented or decremented by a concurrent request when we
    // yielded the event loop to `await` the `storage.put` above!
    // That's why we stored the counter value created by this
    // request in `currentValue` before we used `await`.
    //
    // XXX: double check this comment from the template (I'm not sure
    // this is true since durable objects introduced input/output
    // gate rules)
    // Ticket raised for clarification here:
    // https://github.com/cloudflare/durable-objects-template/issues/11

    return new Response(newValue);
  }
}
