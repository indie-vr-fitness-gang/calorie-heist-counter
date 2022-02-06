# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2022-02-06
### Added
- Added `/increment_server` API for incrementing via `secret` param, without needing to sign URLs
- Added daily/hourly snapshots and `/daily_snapshots` + `/hourly_snapshots` endpoints
- Renamed test tool to `test-api.py` and moved expected config to `../config.json` to keep
  it out of the repo and avoid risk of adding to source control
- Config should now look like:

```
{
    "app_secret": "foobar",
    "server_secret": "foobar",
    "host": "https://indie-gang-api.realfit.co"
}
```