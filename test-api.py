#!/usr/bin/env python3

from http import server
import sys
import time
import hmac
import hashlib
import base64
import requests
import urllib
import json
import argparse

parser = argparse.ArgumentParser(description='Tool for smoke testing API')
parser.add_argument("--verbose", action="store_true", help="Verbose output")
default_config="../config.json"
parser.add_argument('--config', default=default_config, help="Config file including secrets (default = %s)" % default_config)

subparsers = parser.add_subparsers(help='sub-command help', dest='subcommand')

read_parser = subparsers.add_parser('read', help='Simply read counter')

inc_parser = subparsers.add_parser('increment', help='increment the calorie counter')
inc_parser.add_argument('by', type=int, help='How much to increment by')
inc_parser.add_argument("--server-api", action="store_true", help="Increment via server API instead of app/client API")

reset_parser = subparsers.add_parser('reset', help='reset the calorie counter')

daily_snaps_parser = subparsers.add_parser('daily_snapshots', help='Get the daily snapshots')

hourly_snaps_parser = subparsers.add_parser('hourly_snapshots', help='Get the hourly snapshots')

test_parser = subparsers.add_parser('test', help='Smoke test the API')

args = parser.parse_args()

config = None
with open(args.config) as fp:
    config = json.load(fp)
if config == None:
    sys.exit("Failed to load " + args.config)

host = config['host']
app_secret = config['app_secret'].encode('UTF-8')
server_secret = config['server_secret'].encode('UTF-8')


def create_signed_increment_url(by, expire_delta=60):
    global host
    global app_secret

    now = int(time.time())
    expire = now + expire_delta

    payload = "/increment:%d:%d" % (by, expire)
    payload_bytes = payload.encode('ascii')

    # Previously had used a base64 encoding...
    #hash_bytes = hmac.new(secret, payload_bytes, hashlib.sha256).digest()
    #hash_base64 = base64.b64encode(hash_bytes).decode('ascii')
    #print("hash = " + str(hash_base64))

    hash = hmac.new(app_secret, payload_bytes, hashlib.sha256).hexdigest()

    # FIXME: should properly urlencode params
    return "%s/increment?by=%d&expiry=%d&mac=%s" % (host, by, expire, hash)


if args.subcommand == "read":
    url = host + "/"
    r = requests.get(url)
    if r.status_code != 200:
        print("Error: " + r.text)
    else:
        print("Count = " + r.text)
elif args.subcommand == "increment":
    r = None
    if args.server_api:
        url = host + "/server_increment"
        r = requests.get(url, params = {
            "secret": server_secret,
            "by": args.by
        })
    else:
        url = create_signed_increment_url(args.by)
        r = requests.get(url)
    print("Status = " + str(r.status_code))
    if r.status_code == 200:
        print("New Count = " + r.text)
    else:
        print("Error: " + r.text)

elif args.subcommand == "reset":
    url = host + "/reset"
    r = requests.get(url, params = {
        "secret": server_secret
    })
    print("Status = " + str(r.status_code))
    if r.status_code != 200:
        print(r.text)

elif args.subcommand == "daily_snapshots":
    url = host + "/daily_snapshots"
    print("url = " + url)
    r = requests.get(url)
    print("Status = " + str(r.status_code))
    if r.status_code == 200:
        print("Reply = " + json.dumps(r.json(), indent=4))
    else:
        print("Error = " + r.text)

elif args.subcommand == "hourly_snapshots":
    url = host + "/hourly_snapshots"
    r = requests.get(url)
    print("Status = " + str(r.status_code))
    if r.status_code == 200:
        print("Reply = " + json.dumps(r.json(), indent=4))
    else:
        print("Error = " + r.text)

elif args.subcommand == "test":
    # Smoke test the /increment endpoint...

    url = create_signed_increment_url(500)
    print("URL = " + url)

    r = requests.get(url)
    print("status = " + str(r.status_code) + ", text = " + r.text)

    # try replay...
    r = requests.get(url)
    print("replay attempt status = " + str(r.status_code) + ", text = " + r.text)
    assert(r.status_code != 200)

    # Try sending large increment...
    url = create_signed_increment_url(5000, expire_delta=0)
    r = requests.get(url)
    print("large request status = " + str(r.status_code) + ", text = " + r.text)
    assert(r.status_code != 200)

    # Try sending an expired request...
    url = create_signed_increment_url(500, expire_delta=0)
    time.sleep(10)
    r = requests.get(url)
    print("expired request status = " + str(r.status_code) + ", text = " + r.text)
    assert(r.status_code != 200)