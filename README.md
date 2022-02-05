
This 'calorie' counter is based on a Cloudflare Durable Object, so we don't need to have a full database set up for our counter.

Find out more about these in the official [Durable Object documentation](https://developers.cloudflare.com/workers/learning/using-durable-objects).

Worker code is in `src/`. The Durable Object `Counter` class is in `src/counter.mjs`, and the frontend script is in `index.mjs`.


# API

There are currently just three REST API endpoints: `/reset`, `/increment` and read the counter via `/`

The reset API is simply invoked like `GET http://host/reset?secret=12345`

The secret is set via `wrangler secret put COUNTER_RESET_SECRET` and can be shared with whoever may need to reset the counter.


The increment API is invoked like `GET http://host/increment?by=500&expiry=12345678&mac=0f94813426048e4301cd4fd1f3c7d6b86d6c6777452bcf7bbeb8a4fab8245634`

The `by` parameter indicates how much to increment the calorie count (which currently has a maximum of 2000 just to limit the damage of bugs with us incrementing the counter)

The `expiry` limits how long the request URL is valid for, to reduce the chance that people will discover the URL and then replay the request to manually increment the counter.

The `expiry` value should be set to a unix timestamp (in seconds), such as 60 seconds in the future. In python this would be `int(time.time()) + 60`

The `mac` parameter is a SHA-256 hash of an ascii/utf8 string formatted like this: `"/increment:by:expiry"`, e.g. `"/increment:500:12345678"`

The secret for the hash is set via `wrangler secret put COUNTER_RESET_SECRET` and this secret is shared with each particpating app.

It's not an ideal setup, but hopefully ok for our current needs.


# In-Game Integration

For anyone working with C# these utilities could be used to create signed `/increment` urls:

```csharp
using System.Text;
using System.Security.Cryptography;

private static string ToHexDigest(byte[] digest)
{
    StringBuilder hexDigest = new StringBuilder(digest.Length * 2);

    for (int i = 0; i < digest.Length; i++)
    {
        hexDigest.Append(digest[i].ToString("x2"));
    }

    return hexDigest.ToString();
}

private static string SignIncrement(byte[] key, int by, long expiry)
{
    var payload = $"/increment:{by}:{expiry}";
    using (HMACSHA256 hmac = new HMACSHA256(INDIE_GANG_API_KEY))
    {
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        return ToHexDigest(hash);
    }
}

private const string INDIE_GANG_API_HOST = "indie-gang-api.realfit.co";
private static byte[] INDIE_GANG_API_KEY = Encoding.UTF8.GetBytes("asdf1234");

private static string CreateSignedIncrementUrl(int by)
{
    StringBuilder urlBuilder = new StringBuilder("http://", INDIE_GANG_API_HOST.Length + 128);
    long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    long expiry = now + 60;

    var hexDigest = SignIncrement(INDIE_GANG_API_KEY, by, expiry);

    urlBuilder.Append(INDIE_GANG_API_HOST);
    urlBuilder.Append("/increment?by=");
    urlBuilder.Append(by);
    urlBuilder.Append("&expiry=");
    urlBuilder.Append(expiry);
    urlBuilder.Append("&mac=");
    urlBuilder.Append(hexDigest);

    return urlBuilder.ToString();
}
```

# Deploying

Deploying requires a Cloudflare account + domain and payment plan that supports durable objects (configured in `wrangler.toml`)

For now this is configured as a route under indie-gang-api.realfit.co. I can probably share an API key for others to deploy updates

Note: You must use [wrangler](https://developers.cloudflare.com/workers/cli-wrangler/install-update) 1.19.3 or newer to publish/deploy.


# Testing

There is a very simple test for the `/increment` endpoint in `test-signed-increment.py` which also shows how to create a signed url for submitting updates

To run this script first create a `config.json` like:

```json
{
    "increment_secret": "foobar",
    "host": "http://indie-gang-api.realfit.co"
}
```