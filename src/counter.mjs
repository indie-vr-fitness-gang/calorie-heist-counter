
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

function float2int (value) {
  return value | 0;
}

export class Counter {
  constructor(state, env) {

    this.encoder = new TextEncoder();
    this.appSecret = this.encoder.encode(env.APP_SECRET);
    this.serverSecret = env.SERVER_SECRET;

    this.maxIncrement = 2000;

    this.historyPos = 0;
    this.history = new Array(10).fill(null);

    this.maxHourlySnapshots = 24;
    this.maxDailySnapshots = 30;

    this.state = state;
  }


  async do_increment(request, by) {
      let state = await this.state.storage.get(["value", "daily_snapshots", "daily_snapshots_count", "hourly_snapshots", "hourly_snapshots_count"]);


      let currentCount = state.get("value") || 0;
      let dailySnapshots = state.get("daily_snapshots") || [];
      let dailySnapshotsCount = state.get("daily_snapshots_count") || 0; // New snapshots count (goes beyond max length for snapshots!)
      let hourlySnapshots = state.get("hourly_snapshots") || [];
      let hourlySnapshotsCount = state.get("hourly_snapshots_count") || 0;

      // index snapshots with an ephoch timestamps in seconds...
      let now = new Date();
      let dailySnapshotTime = float2int(new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDay()).valueOf() / 1000);
      let hourlySnapshotTime = float2int(new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDay(), now.getUTCHours()).valueOf() / 1000)

      if (dailySnapshotsCount <= 0) {
        dailySnapshots.push([dailySnapshotTime, 0])
        dailySnapshotsCount = 1;
      }
      if (hourlySnapshotsCount <= 0) {
        hourlySnapshots.push([hourlySnapshotTime, 0])
        hourlySnapshotsCount = 1;
      }

      let dailyPos = (dailySnapshotsCount - 1) % this.maxDailySnapshots;
      let hourlyPos = (hourlySnapshotsCount - 1) % this.maxHourlySnapshots;

      let [latestDailyTimestamp, latestDailyCount] = dailySnapshots[dailyPos];
      let [latestHourlyTimestamp, latestHourlyCount] = hourlySnapshots[hourlyPos];


      // Either append the count if we're still in the same day, or create a new snapshot...
      if (latestDailyTimestamp == dailySnapshotTime) {
        dailySnapshots[dailyPos] = [latestDailyTimestamp, latestDailyCount + by];
      } else {
        if (dailySnapshots.length < this.maxDailySnapshots) {
          dailySnapshots.push([dailySnapshotTime, by])
        } else {
          dailyPos += 1;
          dailyPos %= this.maxDailySnapshots;
          dailySnapshots[dailyPos] = [dailySnapshotTime, latestDailyCount + by];
        }
        dailySnapshotsCount += 1
      }

      // Either append the count if we're still in the same hour, or create a new snapshot...
      if (latestHourlyTimestamp == hourlySnapshotTime) {
        hourlySnapshots[hourlyPos] = [latestHourlyTimestamp, latestHourlyCount + by];
      } else {
        if (hourlySnapshots.length < this.maxHourlySnapshots) {
          hourlySnapshots.push([hourlySnapshotTime, by])
        } else {
          hourlyPos += 1;
          hourlyPos %= this.maxHourlySnapshots;
          hourlySnapshots[hourlyPos] = [hourlySnapshotTime, latestHourlyCount + by];
        }
        hourlySnapshotsCount += 1
      }

      this.state.storage.put("value", currentCount + by);
      this.state.storage.put("hourly_snapshots", hourlySnapshots);
      this.state.storage.put("hourly_snapshots_count", hourlySnapshotsCount);
      this.state.storage.put("daily_snapshots", dailySnapshots);
      await this.state.storage.put("daily_snapshots_count", dailySnapshotsCount);  // Only await here to get a write coallece / transaction ...

      return new Response(currentCount + by);
  }

  async handle_app_increment(request, url) {
    if (!url.searchParams.has("mac") || !url.searchParams.has("expiry") || !url.searchParams.has("by")) {
      return new Response("Missing query parameter", { status: 403 })
    }

    const key = await crypto.subtle.importKey(
      "raw",
      this.appSecret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    )

    const expiry = parseInt(url.searchParams.get("expiry"));
    if (expiry === NaN || expiry <= 0) {
      const body = "Invalid Expiry"
      return new Response(body, { status: 400 })
    }

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

    let resp = await this.do_increment(request, by)

    // NB: cloudflare will block the event loop for this worker until
    // this returns (so no other fetch requests will be seen here
    // for this durable object until this is done
    //
    // (input gate rules)

    // Simple circular buffer of recent hashes we can check to thwart simple
    // replay attempts...
    // Note: we don't worry about writing this to storage, an ephemeral in-memory history
    // should be fine here...
    // Note: we only append to the history after the storage has completed
    this.history[this.historyPos++] = receivedMac;
    this.historyPos %= this.history.length;

    return resp;
  }

  async handle_server_increment(request, url) {
    if (!url.searchParams.has("secret") || !url.searchParams.has("by")) {
      return new Response("Missing query parameter", { status: 403 })
    }

    const secret = url.searchParams.get("secret");
    if (secret !== this.serverSecret)
    {
      return new Response("Invalid secret", { status: 403 })
    }

    const by = parseInt(url.searchParams.get("by"));
    if (by === NaN || by <= 0 || by > this.maxIncrement) {
      const body = "Invalid increment 'by' count";
      return new Response(body, { status: 400 })
    }

    return await this.do_increment(request, by)
  }

  async handle_get_snapshots(request, url, name) {
    let state = await this.state.storage.get([name + "_snapshots", name + "_snapshots_count"]);
    let snapshotsBuffer = state.get(name + "_snapshots") || [];
    let snapshotsCount = state.get(name + "_snapshots_count") || 0;
    let start = snapshotsCount % snapshotsBuffer.length;

    // Reorder, instead of sending the circular buffer directly...
    let snapshots = new Array(snapshotsBuffer.length);
    for (let i = 0; i < snapshotsBuffer.length; i++) {
      let pos = (start + i) % snapshotsBuffer.length;
      snapshots[i] = snapshotsBuffer[pos];
    }
    let data = {
      ver: 1,
      snapshots: snapshots
    }

    const json = JSON.stringify(data, null, 2)
    return new Response(json, {
      headers: {
        "content-type": "application/json;charset=UTF-8"
      }
    })
  }

  // Handle HTTP requests from clients.
  async fetch(request) {

    let url = new URL(request.url);

    switch (url.pathname) {
    case "/increment":
      return await this.handle_app_increment(request, url);

    // As an alternative to the /increment endpoint that is used directly by clients/apps where
    // there is more chance of users being able to see those URLs and attempt to forge increment
    // requests, this API can be used by backends simply based on a shared secret that's never
    // exposed to apps
    case "/server_increment":
      return await this.handle_server_increment(request, url);

    case "/reset":

      if (!url.searchParams.has("secret")) {
        return new Response("Missing query parameter", { status: 403 })
      }

      let secret = url.searchParams.get("secret");
      if (secret !== this.serverSecret)
      {
        return new Response("Invalid secret", { status: 403 })
      }

      this.state.storage.put("value", 0);
      this.state.storage.put("hourly_snapshots", []);
      this.state.storage.put("hourly_snapshots_count", 0);
      this.state.storage.put("daily_snapshots", []);
      await this.state.storage.put("daily_snapshots_count", 0);  // Only await here to get a write coallece / transaction ...

      return new Response(0);

    case "/":
      var currentCount = await this.state.storage.get("value") || 0;
      return new Response(currentCount);

    case "/daily_snapshots":
      return await this.handle_get_snapshots(request, url, "daily")

    case "/hourly_snapshots":
      return await this.handle_get_snapshots(request, url, "hourly")


    default:
      return new Response("Not found", {status: 404});
    }

    return new Response("Bad Request", {status: 400});
  }
}
